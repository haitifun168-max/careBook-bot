const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const appointmentService = require('./appointmentService');
const calendarService = require('./calendarService');
const userService = require('./userService');
const db = require('../database');
const messages = require('../utils/messages');

// In-memory session store mapping sessionId -> { username, role }
const activeSessions = {};

// In-memory token store mapping tempToken -> { username, role, expiresAt }
const activeTempTokens = {};

function extractPaymentCode(content) {
    if (!content) return null;
    const prefix = config.PAYMENT_PREFIX || 'CB';
    const escapedPrefix = prefix.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?:${escapedPrefix}|NAP\\s*PAY)\\s*-?\\s*([A-Z0-9]{6,20})`, 'i');
    const match = content.match(regex);
    if (match) {
        // Lấy chính xác tiền tố mà người dùng đã nhập để phản hồi khớp với database
        const matchedPrefix = content.substring(match.index, match.index + match[0].indexOf(match[1])).trim().replace(/\s*-?\s*$/, '');
        const normalizedPrefix = matchedPrefix.toUpperCase().replace(/\s+/g, ' ');
        if (normalizedPrefix === 'NAP PAY') {
            return `NAP PAY-${match[1].toUpperCase()}`;
        }
        return `${normalizedPrefix}${match[1].toUpperCase()}`;
    }
    return null;
}

function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach((cookie) => {
        const parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
    return list;
}

// PBKDF2 Cryptography helpers
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    const [salt, hash] = storedHash.split(':');
    const verify = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verify;
}

function startWebhookServer(bot) {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Register Telegram Webhook if bot has webhookCallback method
    if (config.BOT_TOKEN && config.BOT_TOKEN !== 'your_bot_token_here' && typeof bot.webhookCallback === 'function') {
        const telegramSecretPath = `/webhook/telegram-${config.BOT_TOKEN.slice(0, 10)}`;
        app.use(bot.webhookCallback(telegramSecretPath));
        console.log(`📢 Telegram Webhook path registered at: ${telegramSecretPath}`);
    }

    // Middleware to check authentication and authorization (RBAC)
    function checkRole(allowedRoles) {
        return (req, res, next) => {
            const cookies = parseCookies(req.headers.cookie);
            const sessionId = cookies.session_id;

            if (!sessionId || !activeSessions[sessionId]) {
                if (req.xhr || req.path.includes('/api/')) {
                    return res.status(401).json({ error: 'Unauthorized. Phiên làm việc hết hạn.' });
                }
                return res.redirect('/admin/login');
            }

            const userSession = activeSessions[sessionId];
            if (!allowedRoles.includes(userSession.role)) {
                return res.status(403).json({ error: 'Forbidden. Bạn không có quyền thực hiện hành động này.' });
            }

            req.session = userSession;
            next();
        };
    }

    // Helper: Check if authenticated for dashboard pages
    function isAuthenticated(req) {
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies.session_id;
        return sessionId && activeSessions[sessionId];
    }

    // ═══════════════════════════════════════
    // SEPAY WEBHOOK (VIETQR CONFIRMATION)
    // ═══════════════════════════════════════
    app.post('/webhook/sepay', async (req, res) => {
        const authHeader = req.headers['authorization'];
        
        if (config.SEPAY_API_KEY) {
            if (authHeader !== `Apikey ${config.SEPAY_API_KEY}`) {
                console.log('⚠️ Webhook không có quyền truy cập (Sai API Key)');
                return res.status(401).json({ error: 'Unauthorized' });
            }
        }

        const tx = req.body;
        const rawContent = (tx.content || tx.transactionContent || '').trim();

        if (!tx || !rawContent) {
            return res.status(400).json({ error: 'Bad Request' });
        }

        const paymentCode = extractPaymentCode(rawContent);
        const amount = Math.abs(parseInt(tx.transferAmount || tx.amountIn || 0));

        console.log(`🏦 Nhận webhook SePay: "${rawContent}" (Mã cọc: ${paymentCode}) | Số tiền: ${amount}`);

        if (!paymentCode) {
            // Support SePay test webhook connection
            if (rawContent.toUpperCase().includes('TEST') || rawContent.toUpperCase().includes('SEPAY')) {
                console.log(`🔍 Nhận webhook thử nghiệm từ SePay. Phản hồi OK.`);
                return res.json({ success: true, message: 'Test connection successful' });
            }

            console.log(`❓ Webhook: Nội dung CK không hợp lệ: "${rawContent}"`);
            return res.status(400).json({ error: 'Invalid payment code' });
        }

        try {
            // Find pending appointment matching paymentCode
            const appointment = appointmentService.getByPaymentCode(paymentCode);
            
            if (appointment) {
                if (appointment.status === 'cancelled') {
                    console.log(`⏳ Webhook: Lịch hẹn #${appointment.id} đã bị hủy trước đó. Kiểm tra khả năng khôi phục...`);
                    
                    const hour = appointmentService.getClinicHours().find(h => h.time_label === appointment.booking_time);
                    const occupiedCounts = appointmentService.getOccupiedSlotCounts(appointment.booking_date);
                    const count = occupiedCounts[appointment.booking_time] || 0;
                    const available = hour && hour.is_active && count < hour.max_capacity;

                    if (available) {
                        console.log(`✅ Khung giờ vẫn còn chỗ trống. Khôi phục lịch hẹn #${appointment.id}...`);
                        
                        let calendarEventId = null;
                        const syncResult = await calendarService.createEvent(appointment, appointment.package_name);
                        if (syncResult.success) {
                            calendarEventId = syncResult.eventId;
                        }

                        db.prepare(`
                            UPDATE appointments 
                            SET status = 'confirmed', paid_at = CURRENT_TIMESTAMP, calendar_event_id = ?, calendar_sync_status = ?
                            WHERE id = ?
                        `).run(calendarEventId, calendarEventId ? 'synced' : 'pending', appointment.id);

                        const recoveredAppt = appointmentService.getById(appointment.id);

                        try {
                            const isZalo = String(appointment.user_id).length >= 12;
                            if (isZalo) {
                                const zaloBotService = require('./zaloBotService');
                                await zaloBotService.sendMessage(
                                    String(appointment.user_id),
                                    `⚠️ <b>LỊCH HẸN ĐẶT CỌC TRỄ ĐÃ KHÔI PHỤC!</b>\n\n` +
                                    `Mã lịch: <b>#${appointment.id}</b>\n` +
                                    `🩺 Dịch vụ: <b>${appointment.package_name}</b>\n` +
                                    `📅 Ngày khám: <b>${appointment.booking_date}</b>\n` +
                                    `⏱️ Khung giờ: <b>${appointment.booking_time}</b>\n` +
                                    `💵 Tiền cọc đã nhận: <b>${new Intl.NumberFormat('vi-VN').format(amount)}đ</b>\n\n` +
                                    `💬 <i>Lưu ý: Hệ thống nhận được tiền cọc trễ hạn của bạn sau 15 phút, tuy nhiên khung giờ này vẫn còn trống nên lịch khám của bạn đã được khôi phục thành công trên hệ thống và đồng bộ Google Calendar phòng khám.</i>`,
                                    'html'
                                );
                            } else {
                                await bot.telegram.sendMessage(
                                    appointment.user_id,
                                    `⚠️ <b>LỊCH HẸN ĐẶT CỌC TRỄ ĐÃ KHÔI PHỤC!</b>\n\n` +
                                    `Mã lịch: <b>#${appointment.id}</b>\n` +
                                    `🩺 Dịch vụ: <b>${appointment.package_name}</b>\n` +
                                    `📅 Ngày khám: <b>${appointment.booking_date}</b>\n` +
                                    `⏱️ Khung giờ: <b>${appointment.booking_time}</b>\n` +
                                    `💵 Tiền cọc đã nhận: <b>${new Intl.NumberFormat('vi-VN').format(amount)}đ</b>\n\n` +
                                    `💬 <i>Lưu ý: Hệ thống nhận được tiền cọc trễ hạn của bạn sau 15 phút, tuy nhiên khung giờ này vẫn còn trống nên lịch khám của bạn đã được khôi phục thành công trên hệ thống và đồng bộ Google Calendar phòng khám.</i>`,
                                    { parse_mode: 'HTML' }
                                );
                            }
                        } catch (err) {
                            console.error('Failed to notify customer of recovered appointment:', err.message);
                        }

                        try {
                            const notifyMsg = 
                                `⚠️ <b>KHÔI PHỤC LỊCH HẸN TRỄ CỌC #${appointment.id}</b>\n\n` +
                                `🩺 Dịch vụ: <b>${appointment.package_name}</b>\n` +
                                `👤 Bệnh nhân: <b>${appointment.patient_name}</b>\n` +
                                `📅 Ngày khám: ${appointment.booking_date}\n` +
                                `⏱️ Khung giờ: ${appointment.booking_time}\n` +
                                `💵 Tiền cọc: ${new Intl.NumberFormat('vi-VN').format(amount)}đ\n` +
                                `📅 Google Calendar Sync: ${calendarEventId ? '🟢 OK' : '⚠️ LỖI'}`;
                            await bot.telegram.sendMessage(config.ADMIN_ID, notifyMsg, { parse_mode: 'HTML' });
                        } catch (err) {
                            console.error('Failed to notify admin:', err.message);
                        }

                        return res.json({ success: true, message: `Appointment #${appointment.id} recovered` });
                    } else {
                        console.log(`❌ Khung giờ đã đầy. Tự động hoàn cọc vào ví tích điểm cho user ${appointment.user_id}...`);

                        userService.addBalance(appointment.user_id, amount);
                        const updatedUser = userService.get(appointment.user_id);
                        
                        const formattedPrice = new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
                        const totalBalance = new Intl.NumberFormat('vi-VN').format(updatedUser.balance) + 'đ';

                        const isZalo = String(appointment.user_id).length >= 12;

                        try {
                            if (isZalo) {
                                const zaloBotService = require('./zaloBotService');
                                await zaloBotService.sendMessage(
                                    String(appointment.user_id),
                                    `❌ <b>HỦY LỊCH HẸN & HOÀN CỌC VÀO VÍ</b>\n\n` +
                                    `Hệ thống nhận được khoản chuyển khoản cọc trễ hạn của bạn cho lịch hẹn cũ:\n` +
                                    `🩺 Dịch vụ: ${appointment.package_name}\n` +
                                    `📅 Thời gian: ${appointment.booking_time} ngày ${appointment.booking_date}\n\n` +
                                    `⚠️ Do lịch hẹn đã quá hạn 15 phút và khung giờ này hiện đã được bệnh nhân khác đăng ký trước. Vì vậy, số tiền cọc <b>${formattedPrice}</b> đã được <b>hoàn tự động vào ví tích điểm</b> của bạn.\n` +
                                    `💵 Số dư ví tích điểm hiện tại: <b>${totalBalance}</b>.\n` +
                                    `👉 Bạn có thể dùng số dư ví này để đặt lịch hẹn mới ngay lập tức mà không cần quét mã chuyển khoản lại.`,
                                    'html'
                                );
                            } else {
                                await bot.telegram.sendMessage(
                                    appointment.user_id,
                                    `❌ <b>HỦY LỊCH HẸN & HOÀN CỌC VÀO VÍ</b>\n\n` +
                                    `Hệ thống nhận được khoản chuyển khoản cọc trễ hạn của bạn cho lịch hẹn cũ:\n` +
                                    `🩺 Dịch vụ: ${appointment.package_name}\n` +
                                    `📅 Thời gian: ${appointment.booking_time} ngày ${appointment.booking_date}\n\n` +
                                    `⚠️ Do lịch hẹn đã quá hạn 15 phút và khung giờ này hiện đã được bệnh nhân khác đăng ký trước. Vì vậy, số tiền cọc <b>${formattedPrice}</b> đã được <b>hoàn tự động vào ví tích điểm</b> của bạn.\n` +
                                    `💵 Số dư ví tích điểm hiện tại: <b>${totalBalance}</b>.\n` +
                                    `👉 Bạn có thể dùng số dư ví này để đặt lịch hẹn mới ngay lập tức mà không cần quét mã chuyển khoản lại.`,
                                    { parse_mode: 'HTML' }
                                );
                            }
                        } catch (err) {
                            console.error('Failed to notify customer of automatic refund:', err.message);
                        }

                        try {
                            const notifyMsg = 
                                `💰 <b>HOÀN CỌC TỰ ĐỘNG (LỊCH TRỄ CỌC BỊ ĐẦY CHỖ)</b>\n\n` +
                                `👤 Bệnh nhân: <b>${appointment.patient_name}</b>\n` +
                                `🆔 Kênh: <b>${isZalo ? 'Zalo' : 'Telegram'}</b>\n` +
                                `🆔 ID: <code>${appointment.user_id}</code>\n` +
                                `💵 Tiền cọc nhận: <b>${formattedPrice}</b>\n` +
                                `💵 Trạng thái: Đã tự động hoàn vào ví tích điểm người dùng.\n` +
                                `💵 Số dư ví mới: <b>${totalBalance}</b>`;
                            await bot.telegram.sendMessage(config.ADMIN_ID, notifyMsg, { parse_mode: 'HTML' });
                        } catch (err) {
                            console.error('Failed to notify admin of auto refund:', err.message);
                        }

                        return res.json({ success: true, message: `Appointment #${appointment.id} slot full, refunded to wallet` });
                    }
                }

                if (appointment.status !== 'pending') {
                    console.log(`ℹ️ Webhook: Lịch hẹn #${appointment.id} đã được xử lý (Trạng thái: ${appointment.status})`);
                    return res.json({ success: true, message: 'Already processed' });
                }

                if (amount < appointment.deposit_amount) {
                    console.log(`⚠️ Webhook: Số tiền thanh toán cọc (${amount}) thấp hơn tiền cọc yêu cầu (${appointment.deposit_amount})`);
                    return res.status(400).json({ error: 'Amount mismatch' });
                }

                // Sync to Google Calendar
                let calendarEventId = null;
                const syncResult = await calendarService.createEvent(appointment, appointment.package_name);
                if (syncResult.success) {
                    calendarEventId = syncResult.eventId;
                }

                // Confirm payment & sync
                const confirmResult = appointmentService.confirmPayment(appointment.id, calendarEventId);
                
                if (confirmResult.success) {
                    console.log(`✅ Webhook đã thanh toán cọc & xác nhận lịch hẹn #${appointment.id}`);

                    // Notify customer via Telegram / Zalo
                    try {
                        const isZalo = String(appointment.user_id).length >= 12;
                        if (isZalo) {
                            const zaloBotService = require('./zaloBotService');
                            await zaloBotService.sendMessage(
                                String(appointment.user_id),
                                messages.bookingSuccess(confirmResult.appointment, appointment.package_name),
                                'html'
                            );
                        } else {
                            await bot.telegram.sendMessage(
                                appointment.user_id,
                                messages.bookingSuccess(confirmResult.appointment, appointment.package_name),
                                { parse_mode: 'HTML' }
                            );
                        }
                    } catch (err) {
                        console.error('Failed to notify customer about confirmed booking:', err.message);
                    }

                    // Notify Admin
                    try {
                        const isZalo = String(appointment.user_id).length >= 12;
                        const notifyMsg = 
                            `✅ <b>LỊCH HẸN ĐÃ NHẬN CỌC #${appointment.id}</b>\n\n` +
                            `🩺 Dịch vụ: <b>${appointment.package_name}</b>\n` +
                            `👤 Bệnh nhân: <b>${appointment.patient_name}</b>\n` +
                            `🆔 Kênh: <b>${isZalo ? 'Zalo' : 'Telegram'}</b>\n` +
                            `📅 Ngày khám: ${appointment.booking_date}\n` +
                            `⏱️ Khung giờ: ${appointment.booking_time}\n` +
                            `💵 Số tiền cọc: ${new Intl.NumberFormat('vi-VN').format(amount)}đ\n` +
                            `📅 Google Calendar Sync: ${calendarEventId ? '🟢 OK' : '⚠️ LỖI'}`;
                        await bot.telegram.sendMessage(config.ADMIN_ID, notifyMsg, { parse_mode: 'HTML' });
                    } catch (err) {
                        console.error('Failed to notify admin:', err.message);
                    }

                    return res.json({ success: true, message: `Appointment #${appointment.id} confirmed` });
                } else {
                    return res.status(500).json({ error: 'Failed to confirm appointment' });
                }
            }

            // Check pending deposits if no appointment was found
            const cleanCode = paymentCode.replace(/[-\s]/g, '').toUpperCase();
            const deposit = db.prepare(`
                SELECT *, CAST(user_id AS TEXT) as user_id FROM deposits 
                WHERE REPLACE(REPLACE(payment_code, '-', ''), ' ', '') = ? 
                  AND status = 'pending'
            `).get(cleanCode);
            
            if (deposit) {
                // Complete deposit status
                db.prepare("UPDATE deposits SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(deposit.id);
                
                // Add balance to user
                userService.addBalance(deposit.user_id, amount);
                const updatedUser = userService.get(deposit.user_id);
                
                const formattedPrice = new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
                const totalBalance = new Intl.NumberFormat('vi-VN').format(updatedUser.balance) + 'đ';

                console.log(`✅ Webhook: Đã hoàn tất nạp số dư ví cho user ${deposit.user_id} | Số tiền: ${formattedPrice}`);

                // Notify customer via Telegram / Zalo
                try {
                    const isZalo = String(deposit.user_id).length >= 12;
                    if (isZalo) {
                        const zaloBotService = require('./zaloBotService');
                        await zaloBotService.sendMessage(
                            String(deposit.user_id),
                            `💰 <b>NẠP SỐ DƯ THÀNH CÔNG!</b>\n\n` +
                            `Tài khoản ví của bạn đã được cộng thêm: <b>+${formattedPrice}</b>.\n` +
                            `💵 Số dư ví tích điểm hiện tại: <b>${totalBalance}</b>.`,
                            'html'
                        );
                    } else {
                        await bot.telegram.sendMessage(
                            deposit.user_id,
                            `💰 <b>NẠP SỐ DƯ THÀNH CÔNG!</b>\n\n` +
                            `Tài khoản ví của bạn đã được cộng thêm: <b>+${formattedPrice}</b>.\n` +
                            `💵 Số dư ví tích điểm hiện tại: <b>${totalBalance}</b>.`,
                            { parse_mode: 'HTML' }
                        );
                    }
                } catch (err) {
                    console.error('Failed to notify customer of successful deposit:', err.message);
                }

                // Notify Admin
                try {
                    const isZalo = String(deposit.user_id).length >= 12;
                    const notifyMsg = 
                        `💰 <b>NẠP SỐ DƯ TỰ ĐỘNG THÀNH CÔNG</b>\n\n` +
                        `👤 Bệnh nhân: <b>${updatedUser.full_name || deposit.user_id}</b>\n` +
                        `🆔 Kênh: <b>${isZalo ? 'Zalo' : 'Telegram'}</b>\n` +
                        `🆔 ID: <code>${deposit.user_id}</code>\n` +
                        `💵 Số tiền nạp: <b>${formattedPrice}</b>\n` +
                        `💵 Số dư ví hiện tại: <b>${totalBalance}</b>`;
                    await bot.telegram.sendMessage(config.ADMIN_ID, notifyMsg, { parse_mode: 'HTML' });
                } catch (err) {
                    console.error('Failed to notify admin of deposit:', err.message);
                }

                return res.json({ success: true, message: `Deposit for user ${deposit.user_id} completed` });
            }

            // Fallback for static ID deposits (both Telegram and Zalo)
            // e.g. paymentCode is "CB-5PE61284DOFBI" or "NAP PAY-530718471553674179"
            const staticIdPrefix = config.PAYMENT_PREFIX || 'CB';
            const escapedStaticIdPrefix = staticIdPrefix.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const staticIdRegex = new RegExp(`^(?:${escapedStaticIdPrefix}|NAP\\s*PAY)\\s*-?\\s*([A-Z0-9]{6,20})$`, 'i');
            const staticIdMatch = paymentCode.match(staticIdRegex);

            if (staticIdMatch) {
                const codeSuffix = staticIdMatch[1];
                let targetUserIdStr = null;

                // Nếu là thuần số thì là ID gốc chưa mã hóa (tương thích ngược hoặc debug)
                if (/^\d+$/.test(codeSuffix)) {
                    targetUserIdStr = codeSuffix;
                } else {
                    // Cố gắng giải mã từ mã hóa tĩnh Base36
                    const paymentService = require('./paymentService');
                    targetUserIdStr = paymentService.decryptUserId(codeSuffix);
                }

                if (targetUserIdStr) {
                    const targetUserId = targetUserIdStr;
                    const user = userService.get(targetUserId);
                    if (user) {
                        // Create a completed deposit record
                        db.prepare(`
                            INSERT INTO deposits (user_id, amount, payment_code, status, completed_at)
                            VALUES (?, ?, ?, 'completed', CURRENT_TIMESTAMP)
                        `).run(targetUserId, amount, paymentCode);

                        // Add balance
                        userService.addBalance(targetUserId, amount);
                        const updatedUser = userService.get(targetUserId);

                        const formattedPrice = new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
                        const totalBalance = new Intl.NumberFormat('vi-VN').format(updatedUser.balance) + 'đ';

                        console.log(`✅ Webhook: Đã hoàn tất nạp số dư ví (Static ID) cho user ${targetUserId} | Số tiền: ${formattedPrice}`);

                        const isZalo = targetUserIdStr.length >= 12;
                        if (isZalo) {
                            const zaloBotService = require('./zaloBotService');
                            try {
                                await zaloBotService.sendMessage(
                                    String(targetUserId),
                                    `💰 <b>NẠP SỐ DƯ THÀNH CÔNG!</b>\n\n` +
                                    `Tài khoản ví của bạn đã được cộng thêm: <b>+${formattedPrice}</b>.\n` +
                                    `💵 Số dư ví tích điểm hiện tại: <b>${totalBalance}</b>.`,
                                    'html'
                                );
                            } catch (err) {
                                console.error('Failed to notify Zalo customer of successful deposit:', err.message);
                            }
                        } else {
                            try {
                                await bot.telegram.sendMessage(
                                    targetUserId,
                                    `💰 <b>NẠP SỐ DƯ THÀNH CÔNG!</b>\n\n` +
                                    `Tài khoản ví của bạn đã được cộng thêm: <b>+${formattedPrice}</b>.\n` +
                                    `💵 Số dư ví tích điểm hiện tại: <b>${totalBalance}</b>.`,
                                    { parse_mode: 'HTML' }
                                );
                            } catch (err) {
                                console.error('Failed to notify Telegram customer of successful deposit:', err.message);
                            }
                        }

                        // Notify Admin
                        try {
                            const notifyMsg = 
                                `💰 <b>NẠP SỐ DƯ TỰ ĐỘNG THÀNH CÔNG (TÀI KHOẢN TĨNH)</b>\n\n` +
                                `👤 Bệnh nhân: <b>${updatedUser.full_name || targetUserId}</b>\n` +
                                `🆔 Kênh: <b>${isZalo ? 'Zalo' : 'Telegram'}</b>\n` +
                                `🆔 ID: <code>${targetUserId}</code>\n` +
                                `💵 Số tiền nạp: <b>${formattedPrice}</b>\n` +
                                `💵 Số dư ví hiện tại: <b>${totalBalance}</b>`;
                            await bot.telegram.sendMessage(config.ADMIN_ID, notifyMsg, { parse_mode: 'HTML' });
                        } catch (err) {
                            console.error('Failed to notify admin of static ID deposit:', err.message);
                        }

                        return res.json({ success: true, message: `Static ID Deposit for user ${targetUserId} completed` });
                    }
                }
            }

            console.log(`❓ Webhook: Không tìm thấy lịch hẹn hay yêu cầu nạp tiền khớp với mã: ${paymentCode}`);
            return res.status(404).json({ error: 'Transaction not found' });

        } catch (err) {
            console.error('❌ Webhook SePay error:', err.message);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // ═══════════════════════════════════════
    // PUBLIC ROUTES
    // ═══════════════════════════════════════
    app.get('/', (req, res) => {
        const filePath = path.join(__dirname, '..', 'public', 'index.html');
        if (fs.existsSync(filePath)) {
            res.send(fs.readFileSync(filePath, 'utf8'));
        } else {
            res.status(404).send('Landing page not found');
        }
    });

    app.get('/hero_mockup.png', (req, res) => {
        const filePath = path.join(__dirname, '..', 'public', 'hero_mockup.png');
        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            res.status(404).send('Not Found');
        }
    });

    app.get('/api/public/products', (req, res) => {
        try {
            const categories = db.prepare('SELECT id, name, emoji FROM categories ORDER BY sort_order').all();
            const products = db.prepare(`
                SELECT p.id, p.category_id, p.name, p.price, p.emoji, p.description, p.promotion, p.contact_only, p.contact_url, p.deposit_amount
                FROM products p
                WHERE p.is_active = 1
                ORDER BY p.category_id, p.id
            `).all();

            res.json({
                success: true,
                categories,
                products,
                botUsername: config.BOT_USERNAME || process.env.BOT_USERNAME || 'carebook_bot',
                shopName: config.SHOP_NAME || 'CareBook Clinic',
                supportContact: config.SUPPORT_CONTACT || '@carebook_support'
            });
        } catch (err) {
            console.error('API Public Products Error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // ═══════════════════════════════════════
    // WEB DASHBOARD PAGES
    // ═══════════════════════════════════════
    app.get('/admin/login', (req, res) => {
        // Handle short-lived SSO token login
        if (req.query.token) {
            const token = req.query.token;
            const tokenData = activeTempTokens[token];

            if (tokenData && tokenData.expiresAt > Date.now()) {
                const sessionId = crypto.randomBytes(16).toString('hex');
                activeSessions[sessionId] = { 
                    username: tokenData.username, 
                    role: tokenData.role 
                };

                delete activeTempTokens[token];

                res.cookie('session_id', sessionId, { httpOnly: true });
                return res.redirect('/admin/dashboard');
            } else {
                if (tokenData) delete activeTempTokens[token];
                return res.status(400).send('❌ Liên kết đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng lấy liên kết mới từ Telegram bằng cách dùng lệnh /dashboard.');
            }
        }

        // If already logged in, redirect to dashboard
        if (isAuthenticated(req)) {
            return res.redirect('/admin/dashboard');
        }
        const filePath = path.join(__dirname, '..', 'public', 'login.html');
        if (fs.existsSync(filePath)) {
            res.send(fs.readFileSync(filePath, 'utf8'));
        } else {
            res.status(404).send('Login file not found');
        }
    });

    app.post('/admin/login', (req, res) => {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Vui lòng cung cấp đầy đủ tên đăng nhập và mật khẩu.' });
        }

        try {
            const user = db.prepare('SELECT * FROM dashboard_users WHERE username = ?').get(username);
            if (!user || !verifyPassword(password, user.password_hash)) {
                return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
            }

            // Create session ID
            const sessionId = crypto.randomBytes(32).toString('hex');
            activeSessions[sessionId] = {
                username: user.username,
                role: user.role
            };

            // Set cookie valid for 30 days
            res.setHeader('Set-Cookie', `session_id=${sessionId}; Path=/; HttpOnly; Max-Age=2592000`);
            return res.json({ success: true });
        } catch (err) {
            console.error('Login error:', err.message);
            return res.status(500).json({ error: 'Đã xảy ra lỗi trên hệ thống đăng nhập.' });
        }
    });

    app.get('/admin/dashboard', (req, res) => {
        if (!isAuthenticated(req)) {
            return res.redirect('/admin/login');
        }
        
        // Auto sign cookie if token parameter is used
        if (req.query.token && req.query.token === config.DASHBOARD_TOKEN) {
            const sessionId = crypto.randomBytes(32).toString('hex');
            activeSessions[sessionId] = { username: 'admin', role: 'admin' };
            res.setHeader('Set-Cookie', `session_id=${sessionId}; Path=/; HttpOnly; Max-Age=2592000`);
        }

        const filePath = path.join(__dirname, '..', 'public', 'dashboard.html');
        if (fs.existsSync(filePath)) {
            res.send(fs.readFileSync(filePath, 'utf8'));
        } else {
            res.status(404).send('Dashboard file not found');
        }
    });

    app.get('/admin/logout', (req, res) => {
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies.session_id;
        if (sessionId) {
            delete activeSessions[sessionId];
        }
        res.setHeader('Set-Cookie', 'session_id=; Path=/; HttpOnly; Max-Age=0');
        res.redirect('/admin/login');
    });

    // ═══════════════════════════════════════
    // REST APIs FOR WEB DASHBOARD (RBAC)
    // ═══════════════════════════════════════
    
    // 1. Get statistics & clinic dashboard metadata
    app.get('/admin/api/stats', checkRole(['admin', 'receptionist', 'doctor']), (req, res) => {
        try {
            const stats = appointmentService.getStats();
            
            // Latest 10 appointments
            const recentAppointments = db.prepare(`
                SELECT a.id, a.patient_name, a.patient_phone, a.booking_date, a.booking_time, a.deposit_amount, a.status, a.created_at, p.name as package_name
                FROM appointments a
                JOIN products p ON a.package_id = p.id
                ORDER BY a.created_at DESC
                LIMIT 10
            `).all();

            res.json({
                success: true,
                stats,
                recentAppointments,
                shopName: config.SHOP_NAME,
                user: req.session
            });
        } catch (err) {
            console.error('API Stats Error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // 2. Read packages / products
    app.get('/admin/api/products', checkRole(['admin', 'receptionist', 'doctor']), (req, res) => {
        try {
            const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
            const products = db.prepare(`
                SELECT p.*, c.name as category_name, c.emoji as category_emoji
                FROM products p
                JOIN categories c ON p.category_id = c.id
                ORDER BY p.category_id, p.id
            `).all();
            res.json({ success: true, categories, products });
        } catch (err) {
            console.error('API Products Error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // 3. Edit clinical package details (only admin can change pricing/deposits)
    app.post('/admin/api/products/edit', checkRole(['admin']), (req, res) => {
        try {
            const { id, category_id, name, price, deposit_amount, emoji, promotion, description, is_active } = req.body;
            if (!id || !category_id || !name || !price) {
                return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
            }
            db.prepare(`
                UPDATE products 
                SET category_id = ?, name = ?, price = ?, deposit_amount = ?, is_active = ?, emoji = ?, promotion = ?, description = ?
                WHERE id = ?
            `).run(
                parseInt(category_id),
                name.trim(),
                parseInt(price),
                parseInt(deposit_amount) || 0,
                is_active ? 1 : 0,
                emoji || '🩺',
                promotion || null,
                description || null,
                parseInt(id)
            );
            res.json({ success: true });
        } catch (err) {
            console.error('API Edit Product Error:', err.message);
            res.status(500).json({ error: 'Không thể chỉnh sửa sản phẩm' });
        }
    });

    // 4. Create package
    app.post('/admin/api/products/add', checkRole(['admin']), (req, res) => {
        try {
            const { category_id, name, price, deposit_amount, emoji, promotion, description } = req.body;
            if (!category_id || !name || !price) {
                return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
            }
            const result = db.prepare(`
                INSERT INTO products (category_id, name, price, deposit_amount, emoji, promotion, description, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            `).run(
                parseInt(category_id),
                name.trim(),
                parseInt(price),
                parseInt(deposit_amount) || 0,
                emoji || '🩺',
                promotion || null,
                description || null
            );
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (err) {
            console.error('API Add Product Error:', err.message);
            res.status(500).json({ error: 'Không thể thêm sản phẩm' });
        }
    });

    // 5. Delete package
    app.post('/admin/api/products/delete', checkRole(['admin']), (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Vui lòng cung cấp ID sản phẩm' });

            db.prepare('DELETE FROM products WHERE id = ?').run(parseInt(id));
            res.json({ success: true });
        } catch (err) {
            console.error('API Delete Product Error:', err.message);
            res.status(500).json({ error: 'Không thể xóa sản phẩm' });
        }
    });

    // 6. Get Appointments lists (Calendar View API)
    app.get('/admin/api/appointments', checkRole(['admin', 'receptionist', 'doctor']), (req, res) => {
        try {
            const rows = db.prepare(`
                SELECT a.*, CAST(a.user_id AS TEXT) as user_id, p.name as package_name, p.emoji as package_emoji, u.username as telegram_username
                FROM appointments a
                JOIN products p ON a.package_id = p.id
                LEFT JOIN users u ON a.user_id = u.telegram_id
                ORDER BY a.booking_date DESC, a.booking_time ASC
            `).all();
            
            res.json({ success: true, appointments: rows });
        } catch (err) {
            console.error('API Appointments Error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // 7. Check-in client (Admin & Receptionist)
    app.post('/admin/api/appointments/checkin', checkRole(['admin', 'receptionist']), (req, res) => {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'Thiếu ID lịch hẹn' });

        const result = appointmentService.checkIn(parseInt(id));
        if (result.success) {
            res.json({ success: true });
        } else {
            res.status(400).json({ error: result.error });
        }
    });

    // 8. Cancel appointment & release slot (Admin & Receptionist)
    app.post('/admin/api/appointments/cancel', checkRole(['admin', 'receptionist']), async (req, res) => {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'Thiếu ID lịch hẹn' });

        try {
            const appointment = appointmentService.getById(parseInt(id));
            if (!appointment) {
                return res.status(404).json({ error: 'Lịch hẹn không tồn tại' });
            }

            // Remove from Google Calendar if event exists
            if (appointment.calendar_event_id) {
                await calendarService.deleteEvent(appointment.calendar_event_id);
            }

            // Cancel in SQLite
            appointmentService.cancel(parseInt(id));

            // Notify patient via Telegram
            try {
                await bot.telegram.sendMessage(
                    appointment.user_id,
                    `❌ <b>THÔNG BÁO HỦY LỊCH HẸN</b>\n\n` +
                    `Lịch hẹn mã <b>#${appointment.id}</b> của bạn vào ngày <b>${appointment.booking_date}</b> lúc <b>${appointment.booking_time}</b> đã bị hủy bởi phòng khám.\n` +
                    `Vui lòng liên hệ với bộ phận hỗ trợ y tế nếu có bất kỳ thắc mắc nào.`,
                    { parse_mode: 'HTML' }
                );
            } catch (err) {
                console.error('Failed to notify patient about cancellation:', err.message);
            }

            res.json({ success: true });
        } catch (err) {
            console.error('Cancel appointment error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // 9. Staff Account list (Admin only)
    app.get('/admin/api/staff/list', checkRole(['admin']), (req, res) => {
        try {
            const staff = db.prepare('SELECT id, username, role, created_at FROM dashboard_users ORDER BY id').all();
            res.json({ success: true, staff });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 10. Staff account creation and password resets (Admin only)
    app.post('/admin/api/staff/manage', checkRole(['admin']), (req, res) => {
        const { action, username, password, role } = req.body;

        if (!action || !username) {
            return res.status(400).json({ error: 'Thiếu thông tin bắt buộc (Hành động, Tên đăng nhập)' });
        }

        try {
            if (action === 'create') {
                if (!password || !role) {
                    return res.status(400).json({ error: 'Yêu cầu mật khẩu và phân quyền vai trò.' });
                }

                // Check username exists
                const existing = db.prepare('SELECT id FROM dashboard_users WHERE username = ?').get(username);
                if (existing) {
                    return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại.' });
                }

                const hash = hashPassword(password);
                db.prepare('INSERT INTO dashboard_users (username, password_hash, role) VALUES (?, ?, ?)')
                  .run(username.trim().toLowerCase(), hash, role);
                
                return res.json({ success: true, message: `Đã tạo thành công tài khoản nhân viên ${username}` });
            }

            if (action === 'reset_password') {
                if (!password) {
                    return res.status(400).json({ error: 'Yêu cầu mật khẩu mới.' });
                }

                const hash = hashPassword(password);
                const result = db.prepare('UPDATE dashboard_users SET password_hash = ? WHERE username = ?')
                                 .run(hash, username);

                if (result.changes === 0) {
                    return res.status(404).json({ error: 'Không tìm thấy tài khoản nhân viên.' });
                }

                return res.json({ success: true, message: `Đã đặt lại mật khẩu cho tài khoản ${username}` });
            }

            if (action === 'delete') {
                if (username.toLowerCase() === 'admin') {
                    return res.status(400).json({ error: 'Không thể xóa tài khoản Admin tối cao.' });
                }

                const result = db.prepare('DELETE FROM dashboard_users WHERE username = ?').run(username);
                if (result.changes === 0) {
                    return res.status(404).json({ error: 'Không tìm thấy nhân viên.' });
                }

                return res.json({ success: true, message: 'Đã xóa tài khoản nhân viên thành công.' });
            }

            return res.status(400).json({ error: 'Hành động không hợp lệ.' });
        } catch (err) {
            console.error('Staff manage error:', err.message);
            res.status(500).json({ error: 'Lỗi thực thi quản trị tài khoản.' });
        }
    });

    // ═══════════════════════════════════════
    // ZALO CHATBOT WEBHOOK
    // ═══════════════════════════════════════
    app.post('/webhook/zalo', async (req, res) => {
        // Kiểm tra Secret Token nếu được cấu hình
        if (config.ZALO_BOT_SECRET_TOKEN) {
            const secretHeader = req.headers['x-bot-api-secret-token'];
            if (secretHeader !== config.ZALO_BOT_SECRET_TOKEN) {
                console.warn('⚠️ Webhook Zalo không hợp lệ: Sai Secret Token');
                return res.status(401).json({ error: 'Unauthorized' });
            }
        }

        const update = req.body;
        console.log('📬 Nhận Webhook Update từ Zalo Bot:', JSON.stringify(update));

        // Phản hồi OK ngay lập tức cho Zalo (trong vòng 2s để tránh timeout)
        res.status(200).json({ ok: true });

        // Xử lý tin nhắn bất đồng bộ
        try {
            if (!update) return;

            // 1. Trích xuất Chat ID (hoặc Sender ID của Zalo)
            let chatId = null;
            if (update.message && update.message.chat && update.message.chat.id) {
                chatId = String(update.message.chat.id);
            } else if (update.sender && update.sender.id) {
                chatId = String(update.sender.id);
            }

            if (!chatId) return;

            // 2. Trích xuất nội dung tin nhắn hoặc số điện thoại danh bạ/danh thiếp
            let text = null;
            if (update.message) {
                if (update.message.text) {
                    text = update.message.text;
                } else if (update.message.contact && update.message.contact.phone_number) {
                    text = update.message.contact.phone_number;
                } else if (update.message.attachments && Array.isArray(update.message.attachments)) {
                    // Trích xuất số điện thoại từ đính kèm danh thiếp (business_card)
                    const card = update.message.attachments.find(a => a.type === 'business_card');
                    if (card && card.payload && card.payload.phone) {
                        text = card.payload.phone;
                    }
                }
            }

            // Hỗ trợ bổ sung định dạng Zalo OA event raw (không qua adapter)
            if (!text && update.event_name === 'user_send_business_card' && update.message && update.message.attachments) {
                const card = update.message.attachments.find(a => a.type === 'business_card');
                if (card && card.payload && card.payload.phone) {
                    text = card.payload.phone;
                }
            }

            const fromUser = (update.message && update.message.from) || { id: chatId };
            const senderName = fromUser ? `${fromUser.first_name || ''} ${fromUser.last_name || ''}`.trim() : 'N/A';

            console.log(`💬 Tin nhắn Zalo trích xuất từ [${senderName}] (ChatID: ${chatId}): "${text || ''}"`);

            if (text) {
                const zaloBookingHandler = require('../handlers/zaloBookingHandler');
                await zaloBookingHandler.handleZaloMessage(chatId, text, fromUser);
            }
        } catch (err) {
            console.error('❌ Lỗi xử lý Webhook Zalo:', err.message);
        }
    });

    const port = (config.WEBHOOK_PORT !== undefined && config.WEBHOOK_PORT !== null && config.WEBHOOK_PORT !== '') ? config.WEBHOOK_PORT : 3000;
    const server = app.listen(port, () => {
        console.log(`🌐 Webhook server đang lắng nghe tại cổng ${port}`);
    });
    return server;
}

module.exports = { 
    startWebhookServer,
    activeTempTokens
};
