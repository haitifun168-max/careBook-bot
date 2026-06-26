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

// In-memory token store mapping tempToken -> { username, role, expiresAt }
const activeTempTokens = {};

function extractPaymentCode(content) {
    if (!content) return null;
    const prefix = config.PAYMENT_PREFIX || 'CB';
    const escapedPrefix = prefix.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?:${escapedPrefix}|NAP\\s*PAY)\\s*-?\\s*([A-Z0-9]{6,20})`, 'i');
    const match = content.match(regex);
    if (match) {
        const matchedPrefix = content.substring(match.index, match.index + match[0].indexOf(match[1])).trim().replace(/\s*-?\\s*$/, '');
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

function extractPhoneFromText(inputText) {
    if (!inputText) return null;
    const cleanText = String(inputText).trim();
    const zaloUrlRegex = /(?:https?:\/\/)?(?:www\.)?zalo\.me\/((?:0|84)?\d{9,10})\b/i;
    const match = cleanText.match(zaloUrlRegex);
    if (match) {
        return match[1];
    }
    return cleanText;
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

    // Middleware to check authentication and authorization (RBAC) using DB Sessions
    function checkRole(allowedRoles) {
        return async (req, res, next) => {
            const cookies = parseCookies(req.headers.cookie);
            const sessionId = cookies.session_id;

            if (!sessionId) {
                if (req.xhr || req.path.includes('/api/')) {
                    return res.status(401).json({ error: 'Unauthorized. Phiên làm việc hết hạn.' });
                }
                return res.redirect(`/admin/login?redirect=${encodeURIComponent(req.originalUrl)}`);
            }

            try {
                const sessionRes = await db.query('SELECT * FROM sessions WHERE session_id = $1', [sessionId]);
                const userSession = sessionRes.rows[0];

                if (!userSession) {
                    if (req.xhr || req.path.includes('/api/')) {
                        return res.status(401).json({ error: 'Unauthorized. Phiên làm việc hết hạn.' });
                    }
                    return res.redirect(`/admin/login?redirect=${encodeURIComponent(req.originalUrl)}`);
                }

                if (!allowedRoles.includes(userSession.role)) {
                    return res.status(403).json({ error: 'Forbidden. Bạn không có quyền thực hiện hành động này.' });
                }

                req.session = userSession;
                next();
            } catch (err) {
                console.error('Session verification error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    // Helper: Check if authenticated for dashboard pages
    async function isAuthenticated(req) {
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies.session_id;
        if (!sessionId) return false;
        try {
            const sessionRes = await db.query('SELECT * FROM sessions WHERE session_id = $1', [sessionId]);
            return sessionRes.rows.length > 0;
        } catch (e) {
            return false;
        }
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
            if (rawContent.toUpperCase().includes('TEST') || rawContent.toUpperCase().includes('SEPAY')) {
                console.log(`🔍 Nhận webhook thử nghiệm từ SePay. Phản hồi OK.`);
                return res.json({ success: true, message: 'Test connection successful' });
            }

            console.log(`❓ Webhook: Nội dung CK không hợp lệ: "${rawContent}"`);
            return res.status(400).json({ error: 'Invalid payment code' });
        }

        try {
            // Find pending appointment matching paymentCode
            const appointment = await appointmentService.getByPaymentCode(paymentCode);
            
            if (appointment) {
                if (appointment.status === 'cancelled') {
                    console.log(`⏳ Webhook: Lịch hẹn #${appointment.id} đã bị hủy trước đó. Kiểm tra khả năng khôi phục...`);
                    
                    const clinicHours = await appointmentService.getClinicHours();
                    const hour = clinicHours.find(h => h.time_label === appointment.booking_time);
                    const occupiedCounts = await appointmentService.getOccupiedSlotCounts(appointment.booking_date);
                    const count = occupiedCounts[appointment.booking_time] || 0;
                    const available = hour && hour.is_active && count < hour.max_capacity;

                    if (available) {
                        console.log(`✅ Khung giờ vẫn còn chỗ trống. Khôi phục lịch hẹn #${appointment.id}...`);
                        
                        let calendarEventId = null;
                        const syncResult = await calendarService.createEvent(appointment, appointment.package_name);
                        if (syncResult.success) {
                            calendarEventId = syncResult.eventId;
                        }

                        await db.query(`
                            UPDATE appointments 
                            SET status = 'confirmed', paid_at = NOW(), calendar_event_id = $1, calendar_sync_status = $2
                            WHERE id = $3
                        `, [calendarEventId, calendarEventId ? 'synced' : 'pending', appointment.id]);

                        const recoveredAppt = await appointmentService.getById(appointment.id);

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

                        await userService.addBalance(appointment.user_id, amount);
                        const updatedUser = await userService.get(appointment.user_id);
                        
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
                const confirmResult = await appointmentService.confirmPayment(appointment.id, calendarEventId);
                
                if (confirmResult.success) {
                    console.log(`✅ Webhook đã thanh toán cọc & xác nhận lịch hẹn #${appointment.id}`);

                    // Generate QR Code Check-in link
                    const baseUrl = config.PUBLIC_URL || ('http://' + req.headers.host);
                    const checkinLink = `${baseUrl.replace(/\/$/, '')}/admin/checkin?code=${appointment.payment_code}`;
                    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(checkinLink)}`;

                    // Notify customer via Telegram / Zalo with QR Code check-in
                    try {
                        let successText = messages.bookingSuccess(confirmResult.appointment, appointment.package_name);
                        if (confirmResult.promotionApplied) {
                            const promo = confirmResult.promotionApplied;
                            const formattedValue = new Intl.NumberFormat('vi-VN').format(promo.value) + 'đ';
                            successText += `\n\n🎁 <b>ƯU ĐÃI ĐÃ ÁP DỤNG:</b>\n` +
                                           `Bạn được hoàn tiền <b>+${formattedValue}</b> vào ví tích điểm nhờ chiến dịch <i>"${promo.campaignName}"</i>!`;
                        }

                        const isZalo = String(appointment.user_id).length >= 12;
                        if (isZalo) {
                            const zaloBotService = require('./zaloBotService');
                            await zaloBotService.sendMessage(
                                String(appointment.user_id),
                                successText,
                                'html'
                            );
                            await zaloBotService.sendPhoto(
                                String(appointment.user_id),
                                qrCodeUrl,
                                'Vui lòng đưa mã QR này cho lễ tân để check-in khi đến phòng khám'
                            );
                        } else {
                            await bot.telegram.sendMessage(
                                appointment.user_id,
                                successText,
                                { parse_mode: 'HTML' }
                            );
                            await bot.telegram.sendPhoto(
                                appointment.user_id,
                                qrCodeUrl,
                                { caption: 'Vui lòng đưa mã QR này cho lễ tân để check-in khi đến phòng khám' }
                            );
                        }
                    } catch (err) {
                        console.error('Failed to notify customer about confirmed booking with QR checkin:', err.message);
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
            const depositRes = await db.query(`
                SELECT * FROM deposits 
                WHERE REPLACE(REPLACE(payment_code, '-', ''), ' ', '') = $1 
                  AND status = 'pending'
            `, [cleanCode]);
            const deposit = depositRes.rows[0];
            
            if (deposit) {
                // Complete deposit status
                await db.query("UPDATE deposits SET status = 'completed', completed_at = NOW() WHERE id = $1", [deposit.id]);
                
                // Add balance to user
                await userService.addBalance(deposit.user_id, amount);
                const updatedUser = await userService.get(deposit.user_id);
                
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

            // Fallback for static ID deposits
            const staticIdPrefix = config.PAYMENT_PREFIX || 'CB';
            const escapedStaticIdPrefix = staticIdPrefix.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const staticIdRegex = new RegExp(`^(?:${escapedStaticIdPrefix}|NAP\\s*PAY)\\s*-?\\s*([A-Z0-9]{6,20})$`, 'i');
            const staticIdMatch = paymentCode.match(staticIdRegex);

            if (staticIdMatch) {
                const codeSuffix = staticIdMatch[1];
                let targetUserIdStr = null;

                if (/^\d+$/.test(codeSuffix)) {
                    targetUserIdStr = codeSuffix;
                } else {
                    const paymentService = require('./paymentService');
                    targetUserIdStr = paymentService.decryptUserId(codeSuffix);
                }

                if (targetUserIdStr) {
                    const targetUserId = targetUserIdStr;
                    const user = await userService.get(targetUserId);
                    if (user) {
                        // Create a completed deposit record
                        await db.query(`
                            INSERT INTO deposits (user_id, amount, payment_code, status, completed_at)
                            VALUES ($1, $2, $3, 'completed', NOW())
                        `, [targetUserId, amount, paymentCode]);

                        // Add balance
                        await userService.addBalance(targetUserId, amount);
                        const updatedUser = await userService.get(targetUserId);

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

    app.get('/api/public/products', async (req, res) => {
        try {
            const categoriesRes = await db.query('SELECT id, name, emoji FROM categories ORDER BY sort_order');
            const productsRes = await db.query(`
                SELECT p.id, p.category_id, p.name, p.price, p.emoji, p.description, p.promotion, p.contact_only, p.contact_url, p.deposit_amount
                FROM products p
                WHERE p.is_active = 1
                ORDER BY p.category_id, p.id
            `);

            res.json({
                success: true,
                categories: categoriesRes.rows,
                products: productsRes.rows,
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
    app.get('/admin/login', async (req, res) => {
        // Handle short-lived SSO token login
        if (req.query.token) {
            const token = req.query.token;
            const tokenData = activeTempTokens[token];

            if (tokenData && tokenData.expiresAt > Date.now()) {
                const sessionId = crypto.randomBytes(16).toString('hex');
                
                // Store session to Postgres
                await db.query('INSERT INTO sessions (session_id, username, role) VALUES ($1, $2, $3)', [sessionId, tokenData.username, tokenData.role]);

                delete activeTempTokens[token];

                res.cookie('session_id', sessionId, { httpOnly: true });
                return res.redirect('/admin/dashboard');
            } else {
                if (tokenData) delete activeTempTokens[token];
                return res.status(400).send('❌ Liên kết đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng lấy liên kết mới từ Telegram bằng cách dùng lệnh /dashboard.');
            }
        }

        // If already logged in, redirect to dashboard
        if (await isAuthenticated(req)) {
            return res.redirect('/admin/dashboard');
        }
        const filePath = path.join(__dirname, '..', 'public', 'login.html');
        if (fs.existsSync(filePath)) {
            res.send(fs.readFileSync(filePath, 'utf8'));
        } else {
            res.status(404).send('Login file not found');
        }
    });

    app.post('/admin/login', async (req, res) => {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Vui lòng cung cấp đầy đủ tên đăng nhập và mật khẩu.' });
        }

        try {
            const userRes = await db.query('SELECT * FROM dashboard_users WHERE username = $1', [username]);
            const user = userRes.rows[0];
            if (!user || !verifyPassword(password, user.password_hash)) {
                return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
            }

            // Create session ID
            const sessionId = crypto.randomBytes(32).toString('hex');
            
            // Store session to Postgres
            await db.query('INSERT INTO sessions (session_id, username, role) VALUES ($1, $2, $3)', [sessionId, user.username, user.role]);

            // Set cookie valid for 30 days
            res.setHeader('Set-Cookie', `session_id=${sessionId}; Path=/; HttpOnly; Max-Age=2592000`);
            return res.json({ success: true });
        } catch (err) {
            console.error('Login error:', err.message);
            return res.status(500).json({ error: 'Đã xảy ra lỗi trên hệ thống đăng nhập.' });
        }
    });

    app.get('/admin/dashboard', async (req, res) => {
        if (!(await isAuthenticated(req))) {
            return res.redirect('/admin/login');
        }
        
        // Auto sign cookie if token parameter is used
        if (req.query.token && req.query.token === config.DASHBOARD_TOKEN) {
            const sessionId = crypto.randomBytes(32).toString('hex');
            await db.query('INSERT INTO sessions (session_id, username, role) VALUES ($1, $2, $3)', [sessionId, 'admin', 'admin']);
            res.setHeader('Set-Cookie', `session_id=${sessionId}; Path=/; HttpOnly; Max-Age=2592000`);
        }

        const filePath = path.join(__dirname, '..', 'public', 'dashboard.html');
        if (fs.existsSync(filePath)) {
            res.send(fs.readFileSync(filePath, 'utf8'));
        } else {
            res.status(404).send('Dashboard file not found');
        }
    });

    app.get('/admin/logout', async (req, res) => {
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies.session_id;
        if (sessionId) {
            await db.query('DELETE FROM sessions WHERE session_id = $1', [sessionId]);
        }
        res.setHeader('Set-Cookie', 'session_id=; Path=/; HttpOnly; Max-Age=0');
        res.redirect('/admin/login');
    });

    // ═══════════════════════════════════════
    // REST APIs FOR WEB DASHBOARD (RBAC)
    // ═══════════════════════════════════════
    
    // 1. Get statistics & clinic dashboard metadata
    app.get('/admin/api/stats', checkRole(['admin', 'receptionist', 'doctor']), async (req, res) => {
        try {
            const stats = await appointmentService.getStats();
            
            // Latest 10 appointments
            const recentRes = await db.query(`
                SELECT a.id, a.patient_name, a.patient_phone, a.booking_date, a.booking_time, a.deposit_amount, a.status, a.created_at, p.name as package_name
                FROM appointments a
                JOIN products p ON a.package_id = p.id
                ORDER BY a.created_at DESC
                LIMIT 10
            `);

            res.json({
                success: true,
                stats,
                recentAppointments: recentRes.rows,
                shopName: config.SHOP_NAME,
                user: req.session
            });
        } catch (err) {
            console.error('API Stats Error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // 1b. Get marketing campaigns statistics & listing
    app.get('/admin/api/campaigns', checkRole(['admin']), async (req, res) => {
        try {
            const campaignsRes = await db.query('SELECT * FROM marketing_campaigns ORDER BY id');
            
            // Calculate reminder conversion rate
            const totalRemindersRes = await db.query('SELECT COUNT(*) as c FROM appointments WHERE reminder_sent = 1');
            const convertedRemindersRes = await db.query("SELECT COUNT(*) as c FROM appointments WHERE reminder_sent = 1 AND status IN ('confirmed', 'completed')");
            
            const totalReminders = parseInt(totalRemindersRes.rows[0].c) || 0;
            const convertedReminders = parseInt(convertedRemindersRes.rows[0].c) || 0;
            const reminderConversionRate = totalReminders > 0 ? parseFloat(((convertedReminders / totalReminders) * 100).toFixed(1)) : 0;

            // Calculate CAC (Customer Acquisition Cost) for 'attract' campaign
            const attractCampaign = campaignsRes.rows.find(c => c.type === 'attract');
            let cac = 0;
            if (attractCampaign && attractCampaign.budget_spent > 0) {
                const uniqueUsersRes = await db.query('SELECT COUNT(DISTINCT user_id) as c FROM campaign_usages WHERE campaign_id = $1', [attractCampaign.id]);
                const uniqueUsers = parseInt(uniqueUsersRes.rows[0].c) || 0;
                cac = uniqueUsers > 0 ? Math.round(attractCampaign.budget_spent / uniqueUsers) : 0;
            }

            // Calculate total usages count per campaign
            const usagesCountRes = await db.query('SELECT campaign_id, COUNT(*) as c FROM campaign_usages GROUP BY campaign_id');
            const usagesMap = {};
            usagesCountRes.rows.forEach(r => {
                usagesMap[r.campaign_id] = parseInt(r.c);
            });

            res.json({
                success: true,
                campaigns: campaignsRes.rows.map(c => ({
                    ...c,
                    usage_count: usagesMap[c.id] || 0
                })),
                stats: {
                    totalReminders,
                    convertedReminders,
                    reminderConversionRate,
                    cac
                }
            });
        } catch (err) {
            console.error('API Campaigns Stats Error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // 1c. Get customer statistics & listing
    app.get('/admin/api/reports/customers', checkRole(['admin']), async (req, res) => {
        try {
            // Get total users, returning users, average appointments
            const summaryRes = await db.query(`
                SELECT 
                    (SELECT COUNT(*) FROM users) as total_users,
                    (
                        SELECT COUNT(*) FROM (
                            SELECT user_id FROM appointments 
                            WHERE status IN ('confirmed', 'completed') 
                            GROUP BY user_id HAVING COUNT(*) >= 2
                        ) t
                    ) as returning_users,
                    (
                        SELECT COALESCE(AVG(appt_count), 0) FROM (
                            SELECT COUNT(*) as appt_count FROM appointments 
                            WHERE status IN ('confirmed', 'completed') 
                            GROUP BY user_id
                        ) t
                    ) as avg_appointments_per_user
            `);

            const totalUsers = parseInt(summaryRes.rows[0].total_users) || 0;
            const returningUsers = parseInt(summaryRes.rows[0].returning_users) || 0;
            const newUsers = Math.max(0, totalUsers - returningUsers);
            const retentionRate = totalUsers > 0 ? parseFloat(((returningUsers / totalUsers) * 100).toFixed(1)) : 0;
            const avgAppointments = parseFloat(parseFloat(summaryRes.rows[0].avg_appointments_per_user).toFixed(1)) || 0;

            // Get all customers with their details and booking counts
            const customersRes = await db.query(`
                SELECT 
                    u.telegram_id, 
                    u.username, 
                    u.full_name, 
                    u.balance, 
                    u.created_at,
                    COUNT(CASE WHEN a.status IN ('confirmed', 'completed') THEN 1 END) as completed_appointments_count,
                    MAX(a.created_at) as last_booking_time
                FROM users u
                LEFT JOIN appointments a ON u.telegram_id = a.user_id
                GROUP BY u.telegram_id, u.username, u.full_name, u.balance, u.created_at
                ORDER BY last_booking_time DESC NULLS LAST, u.created_at DESC
            `);

            res.json({
                success: true,
                stats: {
                    totalUsers,
                    newUsers,
                    returningUsers,
                    retentionRate,
                    avgAppointments
                },
                customers: customersRes.rows
            });
        } catch (err) {
            console.error('API Customers Stats Error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // 1d. Create a marketing campaign
    app.post('/admin/api/campaigns', checkRole(['admin']), async (req, res) => {
        try {
            const { name, type, reward_type, value, budget_limit } = req.body;

            if (!name || name.trim() === '') {
                return res.status(400).json({ error: 'Tên chiến dịch không được để trống' });
            }
            if (type !== 'attract' && type !== 'retain') {
                return res.status(400).json({ error: 'Loại chiến dịch không hợp lệ' });
            }
            if (reward_type !== 'cashback') {
                return res.status(400).json({ error: 'Loại ưu đãi không hợp lệ' });
            }
            const rewardVal = parseInt(value);
            const budgetLim = parseInt(budget_limit);

            if (isNaN(rewardVal) || rewardVal <= 0) {
                return res.status(400).json({ error: 'Giá trị ưu đãi phải lớn hơn 0' });
            }
            if (isNaN(budgetLim) || budgetLim < rewardVal) {
                return res.status(400).json({ error: 'Hạn mức ngân sách phải lớn hơn hoặc bằng giá trị ưu đãi' });
            }

            const insertRes = await db.query(
                `INSERT INTO marketing_campaigns (name, type, reward_type, value, budget_limit, budget_spent, is_active)
                 VALUES ($1, $2, $3, $4, $5, 0, 1) RETURNING *`,
                [name.trim(), type, reward_type, rewardVal, budgetLim]
            );

            res.json({ success: true, campaign: insertRes.rows[0] });
        } catch (err) {
            console.error('API Create Campaign Error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // 1e. Update a marketing campaign
    app.put('/admin/api/campaigns/:id', checkRole(['admin']), async (req, res) => {
        try {
            const campaignId = parseInt(req.params.id);
            const { name, budget_limit } = req.body;

            if (!name || name.trim() === '') {
                return res.status(400).json({ error: 'Tên chiến dịch không được để trống' });
            }

            const budgetLim = parseInt(budget_limit);
            if (isNaN(budgetLim) || budgetLim <= 0) {
                return res.status(400).json({ error: 'Hạn mức ngân sách phải lớn hơn 0' });
            }

            // Check if campaign exists and check current spent
            const campaignRes = await db.query('SELECT * FROM marketing_campaigns WHERE id = $1', [campaignId]);
            if (campaignRes.rows.length === 0) {
                return res.status(404).json({ error: 'Không tìm thấy chiến dịch' });
            }

            const campaign = campaignRes.rows[0];
            if (budgetLim < parseInt(campaign.budget_spent)) {
                return res.status(400).json({ error: `Ngân sách mới không được thấp hơn số tiền đã giải ngân (${new Intl.NumberFormat('vi-VN').format(campaign.budget_spent)}đ)` });
            }

            const updateRes = await db.query(
                `UPDATE marketing_campaigns 
                 SET name = $1, budget_limit = $2 
                 WHERE id = $3 RETURNING *`,
                [name.trim(), budgetLim, campaignId]
            );

            res.json({ success: true, campaign: updateRes.rows[0] });
        } catch (err) {
            console.error('API Update Campaign Error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // 1f. Toggle marketing campaign status (is_active = 0 or 1)
    app.patch('/admin/api/campaigns/:id/status', checkRole(['admin']), async (req, res) => {
        try {
            const campaignId = parseInt(req.params.id);
            const { is_active } = req.body;

            const activeStatus = parseInt(is_active) === 1 ? 1 : 0;

            const checkCampaign = await db.query('SELECT * FROM marketing_campaigns WHERE id = $1', [campaignId]);
            if (checkCampaign.rows.length === 0) {
                return res.status(404).json({ error: 'Không tìm thấy chiến dịch' });
            }

            const updateRes = await db.query(
                'UPDATE marketing_campaigns SET is_active = $1 WHERE id = $2 RETURNING *',
                [activeStatus, campaignId]
            );

            res.json({ success: true, campaign: updateRes.rows[0] });
        } catch (err) {
            console.error('API Toggle Campaign Status Error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // 1g. Get campaign usages list (disbursement transactions log)
    app.get('/admin/api/campaigns/usages', checkRole(['admin']), async (req, res) => {
        try {
            const usagesRes = await db.query(`
                SELECT 
                    cu.id, 
                    mc.name as campaign_name, 
                    mc.type as campaign_type, 
                    cu.amount_used, 
                    cu.user_id, 
                    u.full_name as user_name, 
                    cu.appointment_id, 
                    p.name as package_name, 
                    a.booking_date, 
                    cu.created_at
                FROM campaign_usages cu
                JOIN marketing_campaigns mc ON cu.campaign_id = mc.id
                JOIN appointments a ON cu.appointment_id = a.id
                JOIN products p ON a.package_id = p.id
                LEFT JOIN users u ON cu.user_id = u.telegram_id
                ORDER BY cu.created_at DESC
            `);

            res.json({ success: true, usages: usagesRes.rows });
        } catch (err) {
            console.error('API Campaign Usages Error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // 2. Read packages / products
    app.get('/admin/api/products', checkRole(['admin', 'receptionist', 'doctor']), async (req, res) => {
        try {
            const categoriesRes = await db.query('SELECT * FROM categories ORDER BY sort_order');
            const productsRes = await db.query(`
                SELECT p.*, c.name as category_name, c.emoji as category_emoji
                FROM products p
                JOIN categories c ON p.category_id = c.id
                ORDER BY p.category_id, p.id
            `);
            res.json({ success: true, categories: categoriesRes.rows, products: productsRes.rows });
        } catch (err) {
            console.error('API Products Error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // 3. Edit clinical package details
    app.post('/admin/api/products/edit', checkRole(['admin']), async (req, res) => {
        try {
            const { id, category_id, name, price, deposit_amount, emoji, promotion, description, is_active } = req.body;
            if (!id || !category_id || !name || !price) {
                return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
            }
            await db.query(`
                UPDATE products 
                SET category_id = $1, name = $2, price = $3, deposit_amount = $4, is_active = $5, emoji = $6, promotion = $7, description = $8
                WHERE id = $9
            `, [
                parseInt(category_id),
                name.trim(),
                parseInt(price),
                parseInt(deposit_amount) || 0,
                is_active ? 1 : 0,
                emoji || '🩺',
                promotion || null,
                description || null,
                parseInt(id)
            ]);
            res.json({ success: true });
        } catch (err) {
            console.error('API Edit Product Error:', err.message);
            res.status(500).json({ error: 'Không thể chỉnh sửa sản phẩm' });
        }
    });

    // 4. Create package
    app.post('/admin/api/products/add', checkRole(['admin']), async (req, res) => {
        try {
            const { category_id, name, price, deposit_amount, emoji, promotion, description } = req.body;
            if (!category_id || !name || !price) {
                return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
            }
            const result = await db.query(`
                INSERT INTO products (category_id, name, price, deposit_amount, emoji, promotion, description, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
                RETURNING id
            `, [
                parseInt(category_id),
                name.trim(),
                parseInt(price),
                parseInt(deposit_amount) || 0,
                emoji || '🩺',
                promotion || null,
                description || null
            ]);
            res.json({ success: true, id: result.rows[0].id });
        } catch (err) {
            console.error('API Add Product Error:', err.message);
            res.status(500).json({ error: 'Không thể thêm sản phẩm' });
        }
    });

    // 5. Delete package
    app.post('/admin/api/products/delete', checkRole(['admin']), async (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Vui lòng cung cấp ID sản phẩm' });

            await db.query('DELETE FROM products WHERE id = $1', [parseInt(id)]);
            res.json({ success: true });
        } catch (err) {
            console.error('API Delete Product Error:', err.message);
            res.status(500).json({ error: 'Không thể xóa sản phẩm' });
        }
    });

    // 6. Get Appointments lists (Calendar View API)
    app.get('/admin/api/appointments', checkRole(['admin', 'receptionist', 'doctor']), async (req, res) => {
        try {
            const rowsRes = await db.query(`
                SELECT a.*, a.user_id::text as user_id, p.name as package_name, p.emoji as package_emoji, u.username as telegram_username
                FROM appointments a
                JOIN products p ON a.package_id = p.id
                LEFT JOIN users u ON a.user_id = u.telegram_id
                ORDER BY a.booking_date DESC, a.booking_time ASC
            `);
            
            res.json({ success: true, appointments: rowsRes.rows });
        } catch (err) {
            console.error('API Appointments Error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // Helper to send thank you message
    async function sendThankYouNotification(bot, appointment) {
        if (!appointment) return;
        const isZalo = String(appointment.user_id).length >= 12;
        const thankYouText = `💖 <b>CẢM ƠN BẠN ĐÃ SỬ DỤNG DỊCH VỤ!</b>\n\n` +
            `Bác sĩ đã hoàn thành buổi khám cho lịch hẹn <b>#${appointment.id}</b> của bạn.\n` +
            `🩺 Dịch vụ: <b>${appointment.package_name}</b>\n` +
            `👤 Bệnh nhân: <b>${appointment.patient_name}</b>\n` +
            `📅 Ngày khám: <b>${appointment.booking_date}</b>\n\n` +
            `CareBook Clinic kính chúc bạn luôn mạnh khỏe và nhiều niềm vui! Hẹn gặp lại bạn ở những lần khám sau.`;

        try {
            if (isZalo) {
                const zaloBotService = require('./zaloBotService');
                await zaloBotService.sendMessage(String(appointment.user_id), thankYouText, 'html');
            } else {
                await bot.telegram.sendMessage(appointment.user_id, thankYouText, { parse_mode: 'HTML' });
            }
            console.log(`✉️ Đã gửi tin nhắn cảm ơn cho bệnh nhân ${appointment.patient_name} (ID: ${appointment.user_id})`);
        } catch (err) {
            console.error('Lỗi khi gửi tin nhắn cảm ơn cho bệnh nhân:', err.message);
        }
    }

    function renderCheckinPage(status, title, message, appointment = null) {
        let icon = 'ℹ️';
        let iconClass = 'warning-icon';
        if (status === 'success') {
            icon = '✅';
            iconClass = 'success-icon';
        } else if (status === 'error') {
            icon = '❌';
            iconClass = 'danger-icon';
        }

        let detailsHtml = '';
        if (appointment) {
            detailsHtml = `
                <div class="details-card">
                    <div class="detail-row">
                        <span class="detail-label">Mã lịch hẹn</span>
                        <span class="detail-value">#${appointment.id}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Bệnh nhân</span>
                        <span class="detail-value">${appointment.patient_name}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Số điện thoại</span>
                        <span class="detail-value">${appointment.patient_phone}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Dịch vụ</span>
                        <span class="detail-value">${appointment.package_emoji || '🩺'} ${appointment.package_name}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Thời gian</span>
                        <span class="detail-value">${appointment.booking_time} ngày ${appointment.booking_date}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Tổng chi phí</span>
                        <span class="detail-value">${new Intl.NumberFormat('vi-VN').format(appointment.total_price)}đ</span>
                    </div>
                </div>
            `;
        }

        return `
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Xác nhận Check-in — CareBook Clinic</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-gradient: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            --glass-bg: rgba(30, 41, 59, 0.45);
            --glass-border: rgba(255, 255, 255, 0.08);
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --accent: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Outfit', sans-serif;
            background: var(--bg-gradient);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-main);
            padding: 20px;
        }
        .container {
            width: 100%;
            max-width: 500px;
            background: var(--glass-bg);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid var(--glass-border);
            border-radius: 24px;
            padding: 40px 30px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
            text-align: center;
        }
        .status-icon {
            font-size: 4rem;
            margin-bottom: 20px;
            display: inline-block;
        }
        .success-icon { color: var(--accent); }
        .warning-icon { color: var(--warning); }
        .danger-icon { color: var(--danger); }
        h1 {
            font-size: 1.8rem;
            font-weight: 600;
            margin-bottom: 12px;
        }
        .subtitle {
            font-size: 1rem;
            color: var(--text-muted);
            margin-bottom: 30px;
        }
        .details-card {
            background: rgba(15, 23, 42, 0.4);
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            padding: 20px;
            text-align: left;
            margin-bottom: 30px;
        }
        .detail-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 12px;
            font-size: 0.95rem;
        }
        .detail-row:last-child {
            margin-bottom: 0;
            padding-top: 12px;
            border-top: 1px dashed rgba(255, 255, 255, 0.1);
        }
        .detail-label {
            color: var(--text-muted);
        }
        .detail-value {
            font-weight: 500;
            color: var(--text-main);
        }
        .btn-dashboard {
            display: inline-block;
            width: 100%;
            padding: 14px;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid var(--glass-border);
            border-radius: 12px;
            color: var(--text-main);
            text-decoration: none;
            font-weight: 600;
            transition: all 0.3s ease;
        }
        .btn-dashboard:hover {
            background: rgba(255, 255, 255, 0.15);
        }
    </style>
</head>
<body>
    <div class="container">
        <span class="status-icon \${iconClass}">\${icon}</span>
        <h1>\${title}</h1>
        <p class="subtitle">\${message}</p>
        \${detailsHtml}
        <a href="/admin/dashboard" class="btn-dashboard">Quay lại Dashboard</a>
    </div>
</body>
</html>
        `;
    }

    // QR Check-in Endpoint
    app.get('/admin/checkin', checkRole(['admin', 'receptionist']), async (req, res) => {
        const { code } = req.query;
        if (!code) {
            return res.send(renderCheckinPage('error', 'Lỗi Check-in', 'Không tìm thấy mã check-in hợp lệ. Vui lòng quét lại.'));
        }

        try {
            const appointment = await appointmentService.getByPaymentCode(code);
            if (!appointment) {
                return res.send(renderCheckinPage('error', 'Lỗi Check-in', 'Không tìm thấy lịch hẹn khớp với mã check-in này.'));
            }

            if (appointment.status === 'pending') {
                return res.send(renderCheckinPage('warning', 'Chưa thanh toán cọc', 'Lịch hẹn này chưa được xác nhận thanh toán cọc. Lễ tân cần xác nhận cọc trước khi check-in.', appointment));
            }

            if (appointment.status === 'completed') {
                const completedTime = appointment.completed_at ? new Date(appointment.completed_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ngày ' + new Date(appointment.completed_at).toLocaleDateString('vi-VN') : '';
                return res.send(renderCheckinPage('success', 'Đã Check-in', `Lịch hẹn này đã được check-in hoàn tất từ trước${completedTime ? ' vào lúc ' + completedTime : ''}.`, appointment));
            }

            if (appointment.status === 'cancelled') {
                return res.send(renderCheckinPage('error', 'Lịch hẹn đã hủy', 'Lịch hẹn này đã bị hủy bỏ trên hệ thống.', appointment));
            }

            // Status is 'confirmed', do check-in
            const result = await appointmentService.checkIn(appointment.id);
            if (result.success) {
                await sendThankYouNotification(bot, result.appointment);
                return res.send(renderCheckinPage('success', 'Check-in Thành Công', 'Lịch hẹn đã được check-in thành công. Hệ thống đã gửi lời cảm ơn tới bệnh nhân.', result.appointment));
            } else {
                return res.send(renderCheckinPage('error', 'Lỗi Check-in', `Không thể thực hiện check-in: ${result.error}`, appointment));
            }
        } catch (err) {
            console.error('Error in QR checkin:', err);
            return res.status(500).send(renderCheckinPage('error', 'Lỗi hệ thống', 'Đã xảy ra lỗi trên hệ thống khi xử lý check-in.'));
        }
    });

    // 7. Check-in client
    app.post('/admin/api/appointments/checkin', checkRole(['admin', 'receptionist']), async (req, res) => {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'Thiếu ID lịch hẹn' });

        const result = await appointmentService.checkIn(parseInt(id));
        if (result.success) {
            await sendThankYouNotification(bot, result.appointment);
            res.json({ success: true });
        } else {
            res.status(400).json({ error: result.error });
        }
    });

    // 8. Cancel appointment & release slot
    app.post('/admin/api/appointments/cancel', checkRole(['admin', 'receptionist']), async (req, res) => {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'Thiếu ID lịch hẹn' });

        try {
            const appointment = await appointmentService.getById(parseInt(id));
            if (!appointment) {
                return res.status(404).json({ error: 'Lịch hẹn không tồn tại' });
            }

            // Remove from Google Calendar if event exists
            if (appointment.calendar_event_id) {
                await calendarService.deleteEvent(appointment.calendar_event_id);
            }

            // Cancel in Postgres
            await appointmentService.cancel(parseInt(id));

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
    app.get('/admin/api/staff/list', checkRole(['admin']), async (req, res) => {
        try {
            const staffRes = await db.query('SELECT id, username, role, created_at FROM dashboard_users ORDER BY id');
            res.json({ success: true, staff: staffRes.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 10. Staff account creation and password resets (Admin only)
    app.post('/admin/api/staff/manage', checkRole(['admin']), async (req, res) => {
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
                const existingRes = await db.query('SELECT id FROM dashboard_users WHERE username = $1', [username]);
                if (existingRes.rows.length > 0) {
                    return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại.' });
                }

                const hash = hashPassword(password);
                await db.query('INSERT INTO dashboard_users (username, password_hash, role) VALUES ($1, $2, $3)', [username.trim().toLowerCase(), hash, role]);
                
                return res.json({ success: true, message: `Đã tạo thành công tài khoản nhân viên ${username}` });
            }

            if (action === 'reset_password') {
                if (!password) {
                    return res.status(400).json({ error: 'Yêu cầu mật khẩu mới.' });
                }

                const hash = hashPassword(password);
                const result = await db.query('UPDATE dashboard_users SET password_hash = $1 WHERE username = $2', [hash, username]);

                if (result.rowCount === 0) {
                    return res.status(404).json({ error: 'Không tìm thấy tài khoản nhân viên.' });
                }

                return res.json({ success: true, message: `Đã đặt lại mật khẩu cho tài khoản ${username}` });
            }

            if (action === 'delete') {
                if (username.toLowerCase() === 'admin') {
                    return res.status(400).json({ error: 'Không thể xóa tài khoản Admin tối cao.' });
                }

                const result = await db.query('DELETE FROM dashboard_users WHERE username = $1', [username]);
                if (result.rowCount === 0) {
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

    // CSV helper utility
    function convertToCsv(headers, rows) {
        const csvRows = [headers.join(',')];
        for (const row of rows) {
            const values = row.map(val => {
                if (val === null || val === undefined) return '';
                let str = String(val);
                if (val instanceof Date) {
                    str = val.toLocaleString('vi-VN');
                }
                str = str.replace(/"/g, '""');
                if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
                    str = `"${str}"`;
                }
                return str;
            });
            csvRows.push(values.join(','));
        }
        return '\uFEFF' + csvRows.join('\r\n');
    }

    // Export appointments report
    app.get('/admin/api/reports/appointments/export', checkRole(['admin', 'receptionist']), async (req, res) => {
        try {
            const result = await db.query(`
                SELECT a.id, a.patient_name, a.patient_phone, c.name as category_name, p.name as package_name, 
                       a.booking_date, a.booking_time, a.total_price, a.deposit_amount, a.created_at, a.status
                FROM appointments a
                JOIN products p ON a.package_id = p.id
                JOIN categories c ON p.category_id = c.id
                ORDER BY a.created_at DESC
            `);

            const headers = [
                'Mã lịch hẹn', 'Tên bệnh nhân', 'Số điện thoại', 'Chuyên khoa', 'Gói khám',
                'Ngày khám', 'Giờ khám', 'Tổng chi phí (đ)', 'Tiền cọc (đ)', 'Thời gian đặt', 'Trạng thái'
            ];

            const statusMap = {
                pending: 'Chờ thanh toán cọc',
                confirmed: 'Đã cọc / Đã xác nhận',
                completed: 'Đã khám xong',
                cancelled: 'Đã hủy lịch'
            };

            const rows = result.rows.map(a => [
                `#${a.id}`,
                a.patient_name,
                `'${a.patient_phone}`,
                a.category_name,
                a.package_name,
                a.booking_date,
                a.booking_time,
                a.total_price,
                a.deposit_amount,
                a.created_at,
                statusMap[a.status] || a.status
            ]);

            const csvContent = convertToCsv(headers, rows);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename=bao_cao_lich_kham.csv');
            return res.send(csvContent);
        } catch (err) {
            console.error('Export appointments error:', err);
            return res.status(500).send('Lỗi khi xuất báo cáo: ' + err.message);
        }
    });

    // Export financial transactions report
    app.get('/admin/api/reports/transactions/export', checkRole(['admin']), async (req, res) => {
        try {
            const result = await db.query(`
                SELECT 
                    'Nạp ví tích điểm' as type,
                    d.user_id::text as user_id,
                    u.full_name as user_name,
                    d.amount as amount,
                    d.payment_code as payment_code,
                    d.status as status,
                    d.created_at as created_at
                FROM deposits d
                LEFT JOIN users u ON d.user_id = u.telegram_id
                UNION ALL
                SELECT 
                    'Đặt cọc lịch khám' as type,
                    a.user_id::text as user_id,
                    a.patient_name as user_name,
                    a.deposit_amount as amount,
                    a.payment_code as payment_code,
                    a.status as status,
                    a.created_at as created_at
                FROM appointments a
                ORDER BY created_at DESC
            `);

            const headers = [
                'Loại giao dịch', 'ID Khách hàng', 'Tên Khách hàng', 'Số tiền (đ)', 'Mã thanh toán', 'Trạng thái', 'Thời gian tạo'
            ];

            const statusMap = {
                pending: 'Chờ xử lý',
                completed: 'Hoàn tất',
                confirmed: 'Hoàn tất (Đã cọc)',
                cancelled: 'Đã hủy'
            };

            const rows = result.rows.map(t => [
                t.type,
                `'${t.user_id}`,
                t.user_name || 'Khách vãng lai',
                t.amount,
                t.payment_code,
                statusMap[t.status] || t.status,
                t.created_at
            ]);

            const csvContent = convertToCsv(headers, rows);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename=bao_cao_doanh_thu.csv');
            return res.send(csvContent);
        } catch (err) {
            console.error('Export transactions error:', err);
            return res.status(500).send('Lỗi khi xuất báo cáo tài chính: ' + err.message);
        }
    });

    // Export marketing campaigns ROI report
    app.get('/admin/api/reports/campaigns/export', checkRole(['admin']), async (req, res) => {
        try {
            const result = await db.query(`
                SELECT cu.id, mc.name as campaign_name, mc.type as campaign_type, cu.amount_used, 
                       cu.user_id, u.full_name, cu.appointment_id, p.name as package_name, 
                       a.booking_date, cu.created_at
                FROM campaign_usages cu
                JOIN marketing_campaigns mc ON cu.campaign_id = mc.id
                JOIN appointments a ON cu.appointment_id = a.id
                JOIN products p ON a.package_id = p.id
                LEFT JOIN users u ON cu.user_id = u.telegram_id
                ORDER BY cu.created_at DESC
            `);

            const headers = [
                'Mã sử dụng', 'Chiến dịch', 'Loại chiến dịch', 'Mức ưu đãi hoàn tiền (đ)', 'ID Khách hàng', 'Tên Khách hàng', 'Mã lịch hẹn', 'Dịch vụ đã dùng', 'Ngày hẹn khám', 'Thời gian nhận'
            ];

            const typeMap = {
                attract: 'Thu hút khách mới',
                retain: 'Gìn giữ khách cũ'
            };

            const rows = result.rows.map(cu => [
                `#${cu.id}`,
                cu.campaign_name,
                typeMap[cu.campaign_type] || cu.campaign_type,
                cu.amount_used,
                `'${cu.user_id}`,
                cu.full_name || 'Khách hàng',
                `#${cu.appointment_id}`,
                cu.package_name,
                cu.booking_date,
                cu.created_at
            ]);

            const csvContent = convertToCsv(headers, rows);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename=bao_cao_marketing.csv');
            return res.send(csvContent);
        } catch (err) {
            console.error('Export marketing campaigns error:', err);
            return res.status(500).send('Lỗi khi xuất báo cáo marketing: ' + err.message);
        }
    });

    // ═══════════════════════════════════════
    // ZALO CHATBOT WEBHOOK
    // ═══════════════════════════════════════
    app.post('/webhook/zalo', async (req, res) => {
        if (config.ZALO_BOT_SECRET_TOKEN) {
            const secretHeader = req.headers['x-bot-api-secret-token'];
            if (secretHeader !== config.ZALO_BOT_SECRET_TOKEN) {
                console.warn('⚠️ Webhook Zalo không hợp lệ: Sai Secret Token');
                return res.status(401).json({ error: 'Unauthorized' });
            }
        }

        const update = req.body;
        console.log('📬 Nhận Webhook Update từ Zalo Bot:', JSON.stringify(update));

        // Process message
        try {
            if (!update) return res.status(200).json({ ok: true });

            let chatId = null;
            if (update.message && update.message.chat && update.message.chat.id) {
                chatId = String(update.message.chat.id);
            } else if (update.sender && update.sender.id) {
                chatId = String(update.sender.id);
            }

            if (!chatId) return res.status(200).json({ ok: true });

            let text = null;
            if (update.message) {
                if (update.message.text) {
                    text = extractPhoneFromText(update.message.text);
                } else if (update.message.contact && update.message.contact.phone_number) {
                    text = update.message.contact.phone_number;
                } else if (update.message.attachments && Array.isArray(update.message.attachments)) {
                    const card = update.message.attachments.find(a => a.type === 'business_card');
                    if (card && card.payload && card.payload.phone) {
                        text = card.payload.phone;
                    } else {
                        const linkAttachment = update.message.attachments.find(a => a.type === 'link');
                        if (linkAttachment && linkAttachment.payload && linkAttachment.payload.url) {
                            text = extractPhoneFromText(linkAttachment.payload.url);
                        }
                    }
                }
            }

            if (!text && update.event_name === 'user_send_business_card' && update.message && update.message.attachments) {
                const card = update.message.attachments.find(a => a.type === 'business_card');
                if (card && card.payload && card.payload.phone) {
                    text = card.payload.phone;
                }
            }

            if (!text && update.event_name === 'user_submit_info' && update.info && update.info.phone) {
                text = update.info.phone;
            }

            const fromUser = (update.message && update.message.from) || { id: chatId };
            const senderName = fromUser ? `${fromUser.first_name || ''} ${fromUser.last_name || ''}`.trim() : 'N/A';

            console.log(`💬 Tin nhắn Zalo trích xuất từ [${senderName}] (ChatID: ${chatId}): "${text || ''}"`);

            if (text) {
                const zaloBookingHandler = require('../handlers/zaloBookingHandler');
                const contactInfo = {};
                if (update.event_name === 'user_submit_info' && update.info) {
                    contactInfo.name = update.info.name;
                    contactInfo.phone = update.info.phone;
                } else if (update.message && update.message.attachments) {
                    const card = update.message.attachments.find(a => a.type === 'business_card');
                    if (card && card.payload) {
                        contactInfo.name = card.payload.display_name;
                        contactInfo.phone = card.payload.phone;
                    }
                }
                await zaloBookingHandler.handleZaloMessage(chatId, text, fromUser, contactInfo);
            }
        } catch (err) {
            console.error('❌ Lỗi xử lý Webhook Zalo:', err.message);
        }

        res.status(200).json({ ok: true });
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
