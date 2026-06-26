const appointmentService = require('../services/appointmentService');
const productService = require('../services/productService');
const paymentService = require('../services/paymentService');
const userService = require('../services/userService');
const calendarService = require('../services/calendarService');
const config = require('../config');
const zaloBotService = require('../services/zaloBotService');
const db = require('../database');

// In-memory session store for Zalo users
const zaloSessions = {};

/**
 * Format currency helper
 */
function formatPrice(amount) {
    return new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
}

/**
 * Main Message Router for Zalo Bot
 */
async function handleZaloMessage(chatId, text, fromUser, contactInfo = {}) {
    const numericUserId = chatId;
    if (numericUserId && fromUser) {
        // Register user if not exists
        await userService.findOrCreate({
            id: numericUserId,
            username: fromUser.username || null,
            first_name: fromUser.first_name || '',
            last_name: fromUser.last_name || ''
        });
    }

    const cleanText = String(text).trim();
    const normalizedText = cleanText.toLowerCase();

    // Global cancellation handler
    if (normalizedText === 'huy' || normalizedText === 'hủy' || normalizedText === '0' || normalizedText === '/cancel') {
        delete zaloSessions[chatId];
        await zaloBotService.sendMessage(chatId, '❌ Bạn đã hủy bỏ tiến trình đặt lịch.\n\nGõ *start* hoặc phím bất kỳ để quay lại menu chính.');
        return;
    }

    let session = zaloSessions[chatId];

    // If no active session, route commands or show main menu
    if (!session || !session.state) {
        if (normalizedText === '1' || normalizedText === 'dat lich' || normalizedText === 'đặt lịch' || normalizedText === 'datlich') {
            // Start booking flow
            const products = await productService.getAll();
            if (products.length === 0) {
                return zaloBotService.sendMessage(chatId, '⚠️ Hiện tại phòng khám chưa có gói dịch vụ nào hoạt động.');
            }

            zaloSessions[chatId] = {
                state: 'SELECT_PRODUCT',
                tempProducts: products
            };

            if (normalizedText !== '1') {
                const welcomeMsg = `👋 Chào mừng bạn đến với <b>ĐẶT LỊCH TỰ ĐỘNG!</b>\n` +
                                   `Tôi là trợ lý đặt lịch tự động của phòng khám.`;
                await zaloBotService.sendMessage(chatId, welcomeMsg, 'html');
            }

            let menuMsg = '🩺 <b>DANH SÁCH DỊCH VỤ & GÓI KHÁM</b>\n\n';
            products.forEach((prod, index) => {
                menuMsg += `<b>[${index + 1}]</b> ${prod.emoji || '🩺'} <b>${prod.name}</b>\n`;
                menuMsg += `👉 Giá: ${formatPrice(prod.price)} | Cọc giữ chỗ: ${formatPrice(prod.deposit_amount)}\n`;
                if (prod.description) menuMsg += `📝 <i>${prod.description}</i>\n`;
                menuMsg += '\n';
            });
            menuMsg += '👇 Vui lòng nhập số tương ứng của gói khám bạn chọn (ví dụ: 1):';

            await zaloBotService.sendMessage(chatId, menuMsg, 'html');
            return;
        }

        if (normalizedText === '2' || normalizedText === 'thong tin' || normalizedText === 'thông tin' || normalizedText === 'thongtin' || normalizedText === '/menu') {
            const user = await userService.get(numericUserId);
            const name = fromUser ? `${fromUser.first_name || ''} ${fromUser.last_name || ''}`.trim() : 'Khách hàng Zalo';
            const userMsg = 
                `👤 <b>THÔNG TIN BỆNH NHÂN ZALO</b>\n\n` +
                `• Họ tên: <b>${name}</b>\n` +
                `• Zalo ID: <code>${chatId}</code>\n` +
                `• Số dư ví tích điểm: <b>${formatPrice(user ? user.balance : 0)}</b>\n\n` +
                `👉 Bạn có thể nạp thêm tiền vào ví để thanh toán cọc nhanh hơn.`;
            await zaloBotService.sendMessage(chatId, userMsg, 'html');
            return;
        }

        if (normalizedText === '3' || normalizedText === 'dich vu' || normalizedText === 'dịch vụ' || normalizedText === 'dichvu' || normalizedText === '/product') {
            const products = await productService.getAll();
            let menuMsg = '🩺 <b>DANH SÁCH DỊCH VỤ & GÓI KHÁM</b>\n\n';
            products.forEach((prod) => {
                menuMsg += `${prod.emoji || '🩺'} <b>${prod.name}</b> - <b>${formatPrice(prod.price)}</b>\n`;
                menuMsg += `• Mức cọc: ${formatPrice(prod.deposit_amount)}\n`;
                if (prod.description) menuMsg += `• Mô tả: <i>${prod.description}</i>\n`;
                menuMsg += '\n';
            });
            await zaloBotService.sendMessage(chatId, menuMsg, 'html');
            return;
        }

        if (normalizedText === '4' || normalizedText === 'nap tien' || normalizedText === 'nạp tiền' || normalizedText === 'naptien' || normalizedText === '/nap') {
            const user = await userService.get(numericUserId);
            const userZaloId = chatId;

            // Generate a sample payment code for deposit instructions matching Telegram's deposit codes
            const cleanPrefix = (config.PAYMENT_PREFIX || 'CB').replace(/[-\s]/g, '');
            const paymentCode = `${cleanPrefix}${paymentService.encryptUserId(userZaloId)}`;
            const b = config.BANK;
            const qrUrl = paymentService.generateQRUrl(100000, paymentCode, b);

            const depositMsg = 
                `💰 <b>HƯỚNG DẪN NẠP TIỀN VÀO VÍ TÍCH ĐIỂM</b>\n\n` +
                `Để nạp tiền vào ví tích điểm đặt lịch tự động nhanh, vui lòng chuyển khoản theo thông tin sau:\n\n` +
                `🏦 Ngân hàng: <b>${b.NAME}</b>\n` +
                `💳 Số tài khoản: <code>${b.ACCOUNT}</code>\n` +
                `👤 Chủ tài khoản: <b>${b.ACCOUNT_NAME}</b>\n` +
                `💵 Số tiền nạp: <b>Tùy ý (Ví dụ: 100.000đ)</b>\n` +
                `🔑 Nội dung chuyển khoản (bắt buộc): <code>${paymentCode}</code>\n\n` +
                `🔗 <b>Link quét mã QR:</b> <a href="${qrUrl}">Nhấn vào đây để xem ảnh QR nạp tiền</a>\n\n` +
                `⚠️ <i>Lưu ý: Bạn bắt buộc phải ghi đúng nội dung chuyển khoản ở trên để hệ thống tự động ghi nhận số dư ví cho bạn trong vòng 3-5 giây.</i>`;

            try {
                await zaloBotService.sendPhoto(chatId, qrUrl, `Quét mã QR để nạp tiền vào ví tích điểm nhanh`);
                await zaloBotService.sendMessage(chatId, depositMsg, 'html');
            } catch (err) {
                console.error('❌ Lỗi khi gửi ảnh QR nạp tiền qua sendPhoto:', err.message);
                await zaloBotService.sendMessage(chatId, depositMsg, 'html');
            }
            return;
        }

        if (normalizedText === '5' || normalizedText === 'lich hen' || normalizedText === 'lịch hẹn' || normalizedText === 'lichhen' || normalizedText === '/checkpay') {
            try {
                const res = await db.query(`
                    SELECT a.*, p.name as package_name 
                    FROM appointments a 
                    JOIN products p ON a.package_id = p.id 
                    WHERE a.user_id = $1 
                    ORDER BY a.created_at DESC 
                    LIMIT 5
                `, [String(numericUserId)]);
                const appts = res.rows;

                if (appts.length === 0) {
                    return zaloBotService.sendMessage(chatId, '🔍 Bạn chưa có lịch hẹn khám nào được đăng ký trên hệ thống.');
                }

                let apptMsg = '🔍 <b>5 LỊCH HẸN GẦN NHẤT CỦA BẠN:</b>\n\n';
                appts.forEach((appt) => {
                    let statusLabel = '⏳ Chờ cọc';
                    if (appt.status === 'confirmed') statusLabel = '🟢 Đã xác nhận';
                    if (appt.status === 'completed') statusLabel = '🔵 Đã khám xong';
                    if (appt.status === 'cancelled') statusLabel = '❌ Đã hủy';

                    apptMsg += `• <b>Mã lịch: #${appt.id}</b>\n`;
                    apptMsg += `  Dịch vụ: <b>${appt.package_name}</b>\n`;
                    apptMsg += `  Thời gian: <b>${appt.booking_time} ngày ${appt.booking_date}</b>\n`;
                    apptMsg += `  Bệnh nhân: ${appt.patient_name}\n`;
                    apptMsg += `  Trạng thái: <b>${statusLabel}</b>\n\n`;
                });
                await zaloBotService.sendMessage(chatId, apptMsg, 'html');
            } catch (err) {
                console.error('Error fetching appointments for Zalo user:', err.message);
                await zaloBotService.sendMessage(chatId, '❌ Đã xảy ra lỗi khi lấy danh sách lịch hẹn của bạn.');
            }
            return;
        }

        if (normalizedText === '6' || normalizedText === 'ho tro' || normalizedText === 'hỗ trợ' || normalizedText === 'hotro' || normalizedText === '/support') {
            const supportMsg = 
                `🆘 <b>HỖ TRỢ Y TẾ & THÔNG TIN PHÒNG KHÁM</b>\n\n` +
                `🏢 Phòng khám: <b>${config.SHOP_NAME}</b>\n` +
                `📞 Hotline hỗ trợ: <b>${config.SUPPORT_CONTACT}</b>\n\n` +
                `Nếu bạn gặp sự cố chuyển khoản cọc, sai thông tin đặt lịch hoặc cần thay đổi khung giờ khám gấp, vui lòng liên hệ hotline trên hoặc nhắn tin trực tiếp để nhân viên lễ tân hỗ trợ xử lý thủ công.`;
            await zaloBotService.sendMessage(chatId, supportMsg, 'html');
            return;
        }

        if (normalizedText === '7' || normalizedText === 'id' || normalizedText === '/myid') {
            await zaloBotService.sendMessage(chatId, `🆔 Zalo ID của bạn là: <code>${chatId}</code>`, 'html');
            return;
        }

        if (normalizedText === '8' || normalizedText === 'lich su' || normalizedText === 'lịch sử' || normalizedText === 'lichsu') {
            try {
                const transRes = await db.query(`
                    SELECT 
                        'deposit' as type,
                        amount as val,
                        payment_code,
                        status,
                        created_at
                    FROM deposits
                    WHERE user_id = $1
                    UNION ALL
                    SELECT 
                        'appointment' as type,
                        deposit_amount as val,
                        payment_code,
                        status,
                        created_at
                    FROM appointments
                    WHERE user_id = $1
                    ORDER BY created_at DESC
                    LIMIT 10
                `, [String(numericUserId)]);

                let text = '📜 <b>LỊCH SỬ GIAO DỊCH GẦN ĐÂY (ZALO)</b>\n\n';
                if (transRes.rows.length === 0) {
                    text += '<i>Bạn chưa có giao dịch nào trên hệ thống.</i>';
                } else {
                    transRes.rows.forEach(t => {
                        const dateStr = new Date(t.created_at).toLocaleDateString('vi-VN');
                        const formattedAmount = formatPrice(t.val);
                        const typeText = t.type === 'deposit' ? '➕ Nạp ví' : '➖ Trực tiếp (Cọc)';
                        const statusText = t.status === 'completed' || t.status === 'confirmed' ? '✅ Thành công' : (t.status === 'pending' ? '⏳ Chờ xử lý' : '❌ Đã hủy');
                        text += `• <b>${dateStr}</b> | ${typeText}: <b>${formattedAmount}</b>\n` +
                                `  ├ Mã: <code>${t.payment_code}</code>\n` +
                                `  └ Trạng thái: ${statusText}\n\n`;
                    });
                }
                await zaloBotService.sendMessage(chatId, text, 'html');
            } catch (err) {
                console.error('Error fetching Zalo transactions:', err.message);
                await zaloBotService.sendMessage(chatId, '❌ Lỗi hệ thống khi lấy lịch sử giao dịch.');
            }
            return;
        }

        if (normalizedText === '9' || normalizedText === 'uu dai' || normalizedText === 'ưu đãi' || normalizedText === 'uudai') {
            try {
                const activeCampaignsRes = await db.query(`
                    SELECT name, type, value 
                    FROM marketing_campaigns 
                    WHERE is_active = 1 AND budget_spent + value <= budget_limit
                `);

                const myUsagesRes = await db.query(`
                    SELECT mc.name as campaign_name, cu.amount_used, cu.created_at
                    FROM campaign_usages cu
                    JOIN marketing_campaigns mc ON cu.campaign_id = mc.id
                    WHERE cu.user_id = $1
                    ORDER BY cu.created_at DESC
                `, [String(numericUserId)]);

                let text = '🎁 <b>ƯU ĐÃI CỦA BẠN (ZALO)</b>\n\n';

                text += '📢 <b>Chiến dịch ưu đãi hiện tại:</b>\n';
                if (activeCampaignsRes.rows.length === 0) {
                    text += '• <i>Hiện tại chưa có chiến dịch ưu đãi mới.</i>\n\n';
                } else {
                    activeCampaignsRes.rows.forEach(c => {
                        const valText = formatPrice(c.value);
                        const desc = c.type === 'attract' ? 
                            `Tặng <b>+${valText}</b> vào ví tích điểm cho khách mới đặt lịch khám lần đầu.` :
                            `Hoàn tiền <b>+${valText}</b> vào ví tích điểm cho khách cũ khi tái khám cọc thành công.`;
                        text += `• <b>${c.name}</b>\n  └ ${desc}\n\n`;
                    });
                }

                text += '💰 <b>Lịch sử nhận ưu đãi:</b>\n';
                if (myUsagesRes.rows.length === 0) {
                    text += '• <i>Bạn chưa nhận ưu đãi nào. Đặt lịch khám ngay để tích điểm ví!</i>';
                } else {
                    myUsagesRes.rows.forEach(u => {
                        const dateStr = new Date(u.created_at).toLocaleDateString('vi-VN');
                        const amtText = formatPrice(u.amount_used);
                        text += `• <b>${dateStr}</b>: Hoàn <b>+${amtText}</b> từ <i>${u.campaign_name}</i>\n`;
                    });
                }
                await zaloBotService.sendMessage(chatId, text, 'html');
            } catch (err) {
                console.error('Error fetching Zalo promotions:', err.message);
                await zaloBotService.sendMessage(chatId, '❌ Lỗi hệ thống khi lấy thông tin ưu đãi.');
            }
            return;
        }

        const startCommands = ['/start', 'start', '/xinchao', 'xinchao', 'bắt đầu', 'bat dau', 'batdau', 'hello', 'hi', 'chào', 'chao', 'dat lich', 'datlich', 'đặt lịch'];
        if (startCommands.includes(normalizedText)) {
            // Show welcome message
            const welcomeMsg = `👋 Chào mừng bạn đến với <b>ĐẶT LỊCH TỰ ĐỘNG!</b>\n` +
                               `Tôi là trợ lý đặt lịch tự động của phòng khám.`;
            await zaloBotService.sendMessage(chatId, welcomeMsg, 'html');
        }

        // Default Main Menu Response
        const mainMenu = 
            `📅 <b>CHÀO MỪNG BẠN ĐẾN VỚI ĐẶT LỊCH TỰ ĐỘNG!</b>\n` +
            `Hệ thống đặt lịch khám tự động qua Zalo Bot. Vui lòng chọn một số hoặc gõ lệnh tương ứng để tiếp tục:\n\n` +
            `1️⃣ <b>dat lich</b> - Đặt lịch khám mới\n` +
            `2️⃣ <b>thong tin</b> - Xem thông tin bệnh nhân & số dư ví\n` +
            `3️⃣ <b>dich vu</b> - Danh sách gói khám & bảng giá\n` +
            `4️⃣ <b>nap tien</b> - Hướng dẫn nạp ví tích điểm\n` +
            `5️⃣ <b>lich hen</b> - Xem lịch hẹn khám của bạn\n` +
            `6️⃣ <b>ho tro</b> - Hỗ trợ y tế & Liên hệ\n` +
            `7️⃣ <b>id</b> - Lấy ID Zalo cá nhân\n` +
            `8️⃣ <b>lich su</b> - Xem lịch sử giao dịch ví\n` +
            `9️⃣ <b>uu dai</b> - Xem chương trình ưu đãi của tôi\n\n` +
            `👉 <i>Mẹo: Gõ "huy" bất kỳ lúc nào để hủy tiến trình và quay lại menu này.</i>`;

        await zaloBotService.sendMessage(chatId, mainMenu, 'html');
        return;
    }

    // ═══════════════════════════════════════
    // WIZARD STATE MACHINE
    // ═══════════════════════════════════════
    
    // State 1: SELECT_PRODUCT
    if (session.state === 'SELECT_PRODUCT') {
        const choice = parseInt(cleanText) - 1;
        const products = session.tempProducts;
        if (isNaN(choice) || choice < 0 || choice >= products.length) {
            return zaloBotService.sendMessage(chatId, `❌ Lựa chọn không hợp lệ. Vui lòng nhập số từ 1 đến ${products.length}:`);
        }

        const selectedProduct = products[choice];
        session.productId = selectedProduct.id;
        session.state = 'SELECT_DATE';

        // Calculate next 7 days
        const dates = [];
        let dateMsg = `🩺 Gói chọn: <b>${selectedProduct.name}</b>\n\n📅 <b>CHỌN NGÀY KHÁM MONG MUỐN:</b>\n`;
        for (let i = 1; i <= 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() + i);
            const dateStr = d.toISOString().split('T')[0];
            dates.push(dateStr);
            dateMsg += `<b>[${i}]</b> Ngày ${dateStr}\n`;
        }
        session.tempDates = dates;
        dateMsg += '\n👇 Vui lòng nhập số từ 1 đến 7 để chọn ngày (hoặc gõ "huy" để hủy):';

        await zaloBotService.sendMessage(chatId, dateMsg, 'html');
        return;
    }

    // State 2: SELECT_DATE
    if (session.state === 'SELECT_DATE') {
        const choice = parseInt(cleanText) - 1;
        const dates = session.tempDates;
        if (isNaN(choice) || choice < 0 || choice >= dates.length) {
            return zaloBotService.sendMessage(chatId, '❌ Lựa chọn ngày không hợp lệ. Vui lòng nhập số từ 1 đến 7:');
        }

        const selectedDate = dates[choice];
        session.dateStr = selectedDate;
        session.state = 'SELECT_TIME';

        // Fetch slots & counts
        const clinicHours = await appointmentService.getClinicHours();
        const occupiedCounts = await appointmentService.getOccupiedSlotCounts(selectedDate);
        const availableSlots = [];

        let slotMsg = `📅 Ngày chọn: <b>${selectedDate}</b>\n\n⏱️ <b>CHỌN KHUNG GIỜ KHÁM TRỐNG:</b>\n`;
        let activeIndex = 1;
        
        clinicHours.forEach((hour) => {
            if (!hour.is_active) return;
            const count = occupiedCounts[hour.time_label] || 0;
            const isFull = count >= hour.max_capacity;
            
            if (isFull) {
                slotMsg += `🔴 [Đầy] Khung giờ ${hour.time_label}\n`;
            } else {
                availableSlots.push(hour);
                slotMsg += `<b>[${activeIndex}]</b> Khung giờ 🟢 <b>${hour.time_label}</b> (Còn trống)\n`;
                activeIndex++;
            }
        });

        if (availableSlots.length === 0) {
            delete zaloSessions[chatId];
            return zaloBotService.sendMessage(chatId, '❌ Rất tiếc, ngày này phòng khám đã kín lịch hẹn khám. Vui lòng gõ "start" để chọn ngày khác.');
        }

        session.tempSlots = availableSlots;
        slotMsg += '\n👇 Vui lòng nhập số tương ứng của khung giờ bạn chọn:';
        await zaloBotService.sendMessage(chatId, slotMsg, 'html');
        return;
    }

    // State 3: SELECT_TIME
    if (session.state === 'SELECT_TIME') {
        const choice = parseInt(cleanText) - 1;
        const slots = session.tempSlots;
        if (isNaN(choice) || choice < 0 || choice >= slots.length) {
            return zaloBotService.sendMessage(chatId, `❌ Khung giờ không hợp lệ. Vui lòng nhập số từ 1 đến ${slots.length}:`);
        }

        const selectedHour = slots[choice];
        session.hourId = selectedHour.id;
        session.timeLabel = selectedHour.time_label;
        session.state = 'ASK_PATIENT_TYPE';

        const patientTypeMsg = 
            `📅 Lịch hẹn: Ngày <b>${session.dateStr}</b> lúc <b>${session.timeLabel}</b>\n\n` +
            `❓ <b>BẠN MUỐN ĐĂNG KÝ ĐẶT LỊCH KHÁM CHO AI?</b>\n` +
            `<b>[1]</b> Đăng ký cho bản thân\n` +
            `<b>[2]</b> Đăng ký cho người thân\n\n` +
            `👇 Vui lòng nhập 1 hoặc 2:`;

        await zaloBotService.sendMessage(chatId, patientTypeMsg, 'html');
        return;
    }

    // State 4: ASK_PATIENT_TYPE
    if (session.state === 'ASK_PATIENT_TYPE') {
        if (cleanText === '1') {
            session.patientType = 'self';
            session.state = 'WAITING_PATIENT_NAME';

            await zaloBotService.sendMessage(chatId, '👤 Vui lòng nhập <b>Họ tên đầy đủ</b> của bạn (để phòng khám lập hồ sơ y tế):', 'html');
            return;
        } else if (cleanText === '2') {
            session.patientType = 'other';
            session.state = 'WAITING_PATIENT_NAME';

            await zaloBotService.sendMessage(chatId, '👤 Vui lòng nhập <b>Họ tên đầy đủ</b> của người đi khám:', 'html');
            return;
        } else {
            return zaloBotService.sendMessage(chatId, '❌ Vui lòng chọn 1 (đăng ký cho bản thân) hoặc 2 (đăng ký cho người thân):');
        }
    }

    // Helper to process shared contact info (business card or submit info)
    const processSharedContact = async () => {
        if (contactInfo && contactInfo.phone) {
            let phoneInput = contactInfo.phone.replace(/[\s\-\.\+]/g, '');
            if (phoneInput.length === 9 && !phoneInput.startsWith('0') && !phoneInput.startsWith('84')) {
                phoneInput = '0' + phoneInput;
            }
            if (phoneInput.startsWith('84')) {
                phoneInput = '0' + phoneInput.substring(2);
            }
            session.patientPhone = phoneInput;
            session.patientName = contactInfo.name || session.patientName || 'Khách hàng Zalo';
            session.state = 'CONFIRM_BOOKING';

            const product = await productService.getById(session.productId);
            const user = await userService.get(numericUserId);
            const balance = user ? user.balance : 0;
            const hasEnoughBalance = balance >= product.deposit_amount;

            let confirmMsg = 
                `📝 <b>BẢNG XÁC NHẬN THÔNG TIN ĐẶT LỊCH HẸN</b>\n\n` +
                `• Gói dịch vụ: <b>${product.name}</b>\n` +
                `• Ngày khám: <b>${session.dateStr}</b>\n` +
                `• Khung giờ: <b>${session.timeLabel}</b>\n` +
                `• Người khám: <b>${session.patientName}</b> (${session.patientType === 'self' ? 'Bản thân' : 'Người thân'})\n` +
                `• Số điện thoại: <b>${session.patientPhone}</b>\n` +
                `• Tiền cọc yêu cầu: <b>${formatPrice(product.deposit_amount)}</b>\n` +
                `• Số dư ví hiện tại: <b>${formatPrice(balance)}</b>\n\n` +
                `👇 <b>CHỌN PHƯƠNG THỨC THANH TOÁN CỌC:</b>\n` +
                `<b>[1]</b> Nhận mã QR VietQR chuyển khoản (giữ chỗ 15 phút)\n`;

            if (hasEnoughBalance) {
                confirmMsg += `<b>[2]</b> Trừ tiền trực tiếp từ ví tích điểm\n`;
            } else {
                confirmMsg += `❌ [Ví không đủ số dư] Trừ ví (Nhập nạp tiền ví nếu cần)\n`;
            }
            confirmMsg += `<b>[3]</b> Hủy bỏ đăng ký đặt lịch này\n\n`;
            confirmMsg += `👇 Vui lòng nhập số tương ứng của lựa chọn:`;

            session.hasEnoughBalance = hasEnoughBalance;
            await zaloBotService.sendMessage(chatId, confirmMsg, 'html');
            return true;
        }
        return false;
    };

    // State 5: WAITING_PATIENT_NAME
    if (session.state === 'WAITING_PATIENT_NAME') {
        const isShared = await processSharedContact();
        if (isShared) return;

        if (cleanText.length < 2) {
            const errorMsg = session.patientType === 'self' ? 
                '❌ Họ tên quá ngắn. Vui lòng nhập đầy đủ họ và tên của bạn:' : 
                '❌ Họ tên quá ngắn. Vui lòng nhập đầy đủ họ và tên bệnh nhân:';
            return zaloBotService.sendMessage(chatId, errorMsg);
        }
        session.patientName = cleanText;
        session.state = 'WAITING_PATIENT_PHONE';

        const phoneMsg = session.patientType === 'self' ? 
            '📞 Vui lòng nhập <b>Số điện thoại liên hệ</b> của bạn (Ví dụ: 0912345678):' : 
            '📞 Vui lòng nhập <b>Số điện thoại</b> liên hệ của người đi khám (Ví dụ: 0912345678):';
        await zaloBotService.sendMessage(chatId, phoneMsg, 'html');
        return;
    }

    // State 6: WAITING_PATIENT_PHONE
    if (session.state === 'WAITING_PATIENT_PHONE') {
        const isShared = await processSharedContact();
        if (isShared) return;

        // Clean all spaces, dashes, dots, and +
        let phoneInput = cleanText.replace(/[\s\-\.\+]/g, '');

        // Auto-prepend '0' if user entered a 9-digit number not starting with '0'
        if (phoneInput.length === 9 && !phoneInput.startsWith('0') && !phoneInput.startsWith('84')) {
            phoneInput = '0' + phoneInput;
        }

        // Match 10 to 11 digits format
        const phoneRegex = /^(0|84)\d{9,10}$/;
        if (!phoneRegex.test(phoneInput)) {
            return zaloBotService.sendMessage(chatId, '❌ Số điện thoại không hợp lệ. Vui lòng nhập đúng 10 số (Ví dụ: 0912345678):');
        }

        let phone = phoneInput;
        if (phone.startsWith('84')) phone = '0' + phone.substring(2);
        session.patientPhone = phone;

        session.state = 'CONFIRM_BOOKING';

        // Prepare confirmation details
        const product = await productService.getById(session.productId);
        const user = await userService.get(numericUserId);
        const balance = user ? user.balance : 0;
        const hasEnoughBalance = balance >= product.deposit_amount;

        let confirmMsg = 
            `📝 <b>BẢNG XÁC NHẬN THÔNG TIN ĐẶT LỊCH HẸN</b>\n\n` +
            `• Gói dịch vụ: <b>${product.name}</b>\n` +
            `• Ngày khám: <b>${session.dateStr}</b>\n` +
            `• Khung giờ: <b>${session.timeLabel}</b>\n` +
            `• Người khám: <b>${session.patientName}</b> (${session.patientType === 'self' ? 'Bản thân' : 'Người thân'})\n` +
            `• Số điện thoại: <b>${session.patientPhone}</b>\n` +
            `• Tiền cọc yêu cầu: <b>${formatPrice(product.deposit_amount)}</b>\n` +
            `• Số dư ví hiện tại: <b>${formatPrice(balance)}</b>\n\n` +
            `👇 <b>CHỌN PHƯƠNG THỨC THANH TOÁN CỌC:</b>\n` +
            `<b>[1]</b> Nhận mã QR VietQR chuyển khoản (giữ chỗ 15 phút)\n`;

        if (hasEnoughBalance) {
            confirmMsg += `<b>[2]</b> Trừ tiền trực tiếp từ ví tích điểm\n`;
        } else {
            confirmMsg += `❌ [Ví không đủ số dư] Trừ ví (Nhập nạp tiền ví nếu cần)\n`;
        }
        confirmMsg += `<b>[3]</b> Hủy bỏ đăng ký đặt lịch này\n\n`;
        confirmMsg += `👇 Vui lòng nhập số tương ứng của lựa chọn:`;

        session.hasEnoughBalance = hasEnoughBalance;
        await zaloBotService.sendMessage(chatId, confirmMsg, 'html');
        return;
    }

    // State 7: CONFIRM_BOOKING
    if (session.state === 'CONFIRM_BOOKING') {
        const product = await productService.getById(session.productId);

        if (cleanText === '1') {
            // QR Payment method selected
            const paymentCode = paymentService.generatePaymentCode();
            const qrUrl = paymentService.generateQRUrl(product.deposit_amount, paymentCode);

            // Create appointment in database (pending state) using transactional createSafe
            let appointmentId;
            try {
                appointmentId = await appointmentService.createSafe({
                    userId: numericUserId,
                    packageId: session.productId,
                    patientName: session.patientName,
                    patientPhone: session.patientPhone,
                    bookingDate: session.dateStr,
                    bookingTime: session.timeLabel,
                    totalPrice: product.price,
                    depositAmount: product.deposit_amount,
                    paymentCode
                });
            } catch (err) {
                if (err.message === 'SLOT_FULL') {
                    delete zaloSessions[chatId];
                    return zaloBotService.sendMessage(chatId, '❌ Rất tiếc, khung giờ này vừa mới bị đặt hết chỗ. Vui lòng gõ "start" để thử lại.');
                }
                throw err;
            }

            const appointment = await appointmentService.getById(appointmentId);

            // Send instructions
            const payInstructions = 
                `💸 <b>HƯỚNG DẪN CHUYỂN KHOẢN ĐẶT CỌC</b>\n\n` +
                `Vui lòng quét mã QR gửi kèm hoặc chuyển khoản thủ công theo thông tin:\n\n` +
                `🏦 Ngân hàng: <b>${config.BANK.NAME}</b>\n` +
                `💳 Số tài khoản: <code>${config.BANK.ACCOUNT}</code>\n` +
                `💵 Số tiền cọc: <b>${formatPrice(product.deposit_amount)}</b>\n` +
                `🔑 Nội dung chuyển khoản (bắt buộc): <code>${paymentCode}</code>\n\n` +
                `🔗 <b>Link quét mã QR:</b> <a href="${qrUrl}">Nhấn vào đây để xem ảnh QR đặt cọc</a>\n\n` +
                `⚠️ <i>Lưu ý: Khung giờ của bạn được tạm khóa giữ chỗ trong 15 phút. Sau 15 phút nếu không nhận được tiền cọc, hệ thống sẽ tự động hủy lịch để giải phóng khung giờ.</i>`;

            try {
                await zaloBotService.sendPhoto(chatId, qrUrl, `Quét mã VietQR để thanh toán cọc giữ chỗ khám`);
                await zaloBotService.sendMessage(chatId, payInstructions, 'html');
            } catch (err) {
                console.error('❌ Lỗi khi gửi ảnh QR đặt cọc qua sendPhoto:', err.message);
                await zaloBotService.sendMessage(chatId, payInstructions, 'html');
            }

            // Clear session state
            delete zaloSessions[chatId];

            // Notify Admin about new pending booking
            const adminMsg = 
                `🔔 <b>LỊCH ĐĂNG KÝ MỚI (CHỜ CỌC ZALO) #${appointment.id}</b>\n\n` +
                `🩺 Dịch vụ: <b>${product.name}</b>\n` +
                `👤 Bệnh nhân: <b>${appointment.patient_name}</b>\n` +
                `📱 SĐT: <code>${appointment.patient_phone}</code>\n` +
                `📅 Ngày khám: ${appointment.booking_date}\n` +
                `⏱️ Giờ khám: ${appointment.booking_time}\n` +
                `💵 Tiền cọc: <b>${formatPrice(product.deposit_amount)}</b>\n` +
                `🔑 Mã nội dung: <code>${paymentCode}</code>\n\n` +
                `⏱️ <i>Lịch giữ chỗ sẽ tự động hủy sau 15 phút nếu khách chưa chuyển khoản cọc.</i>`;
            
            const adminExistsRes = await db.query('SELECT telegram_id FROM users WHERE telegram_id = $1', [String(config.ADMIN_ID)]);
            if (adminExistsRes.rows.length > 0) {
                zaloBotService.sendMessage(String(config.ADMIN_ID), adminMsg, 'html').catch(() => {});
            }

            // 15-Minute Expiration Timer for Zalo
            const timer = setTimeout(async () => {
                try {
                    const freshAppt = await appointmentService.getById(appointment.id);
                    if (freshAppt && freshAppt.status === 'pending') {
                        await appointmentService.cancel(appointment.id);
                        
                        // Alert customer via Zalo
                        await zaloBotService.sendMessage(
                            appointment.user_id,
                            `❌ <b>LỊCH HẸN CHỜ CỌC ĐÃ BỊ HỦY DO HẾT HẠN!</b>\n\n` +
                            `Lịch hẹn của bạn cho dịch vụ <b>${product.name}</b> vào ngày <b>${appointment.booking_date}</b> lúc <b>${appointment.booking_time}</b> đã bị hủy do chúng tôi không nhận được tiền cọc sau 15 phút giữ chỗ.\n` +
                            `Vui lòng thực hiện đặt lịch lại nếu bạn vẫn muốn khám bệnh.`,
                            'html'
                        );

                        // Notify Admin about auto-cancellation
                        const adminCancelMsg = 
                            `❌ <b>LỊCH HẸN ZALO TỰ HỦY DO HẾT HẠN CỌC #${appointment.id}</b>\n\n` +
                            `👤 Bệnh nhân: ${appointment.patient_name}\n` +
                            `📅 Ngày khám: ${appointment.booking_date} (${appointment.booking_time})\n` +
                            `🩺 Dịch vụ: ${product.name}`;
                        zaloBotService.sendMessage(config.ADMIN_ID, adminCancelMsg, 'html').catch(() => {});
                    }
                } catch (err) {
                    console.error(`Error in Zalo appointment #${appointment.id} expiration timer:`, err.message);
                }
            }, 15 * 60 * 1000);
            if (timer && typeof timer.unref === 'function') {
                timer.unref();
            }

            return;
        } else if (cleanText === '2' && session.hasEnoughBalance) {
            // Wallet Payment method selected
            const paymentCode = paymentService.generatePaymentCode('WALLET');

            // Create appointment in database (already confirmed!) using transactional createSafe
            let appointmentId;
            try {
                appointmentId = await appointmentService.createSafe({
                    userId: numericUserId,
                    packageId: session.productId,
                    patientName: session.patientName,
                    patientPhone: session.patientPhone,
                    bookingDate: session.dateStr,
                    bookingTime: session.timeLabel,
                    totalPrice: product.price,
                    depositAmount: product.deposit_amount,
                    paymentCode
                });
            } catch (err) {
                if (err.message === 'SLOT_FULL') {
                    delete zaloSessions[chatId];
                    return zaloBotService.sendMessage(chatId, '❌ Rất tiếc, khung giờ này vừa mới bị đặt hết chỗ. Vui lòng gõ "start" để thử lại.');
                }
                throw err;
            }

            // Deduct balance
            await userService.deductBalance(numericUserId, product.deposit_amount);

            // Fetch created appointment
            const appointment = await appointmentService.getById(appointmentId);

            // Sync to Google Calendar
            let calendarEventId = null;
            const syncResult = await calendarService.createEvent(appointment, product.name);
            if (syncResult.success) {
                calendarEventId = syncResult.eventId;
            }

            // Confirm payment & sync
            await appointmentService.confirmPayment(appointment.id, calendarEventId);
            const confirmedAppt = await appointmentService.getById(appointment.id);

            // Reply success
            const successMsg = 
                `` +
                `✅ <b>ĐẶT LỊCH KHÁM THÀNH CÔNG!</b>\n\n` +
                `Lịch hẹn của bạn đã được xác nhận thanh toán cọc bằng số dư ví:\n\n` +
                `• Mã lịch khám: <b>#${confirmedAppt.id}</b>\n` +
                `• Dịch vụ khám: <b>${product.name}</b>\n` +
                `• Ngày khám: <b>${confirmedAppt.booking_date}</b>\n` +
                `• Khung giờ: <b>${confirmedAppt.booking_time}</b>\n` +
                `• Bệnh nhân: <b>${confirmedAppt.patient_name}</b>\n` +
                `• Tiền cọc đã thanh toán: <b>${formatPrice(product.deposit_amount)} (Ví)</b>\n\n` +
                `Phòng khám Hân hạnh được đón tiếp bạn!`;
            
            await zaloBotService.sendMessage(chatId, successMsg, 'html');

            // Clear session state
            delete zaloSessions[chatId];

            // Notify Admin about new booking via Wallet
            const adminMsg = 
                `🔔 <b>LỊCH ĐẶT MỚI QUA ZALO (ĐÃ CỌC VÍ) #${appointment.id}</b>\n\n` +
                `🩺 Dịch vụ: <b>${product.name}</b>\n` +
                `👤 Bệnh nhân: <b>${appointment.patient_name}</b>\n` +
                `📱 SĐT: <code>${appointment.patient_phone}</code>\n` +
                `📅 Ngày khám: ${appointment.booking_date}\n` +
                `⏱️ Giờ khám: ${appointment.booking_time}\n` +
                `💵 Tiền cọc: <b>${formatPrice(product.deposit_amount)} (Ví Zalo)</b>\n` +
                `📅 Google Calendar Sync: ${calendarEventId ? '🟢 OK' : '⚠️ LỖI'}`;
            
            zaloBotService.sendMessage(config.ADMIN_ID, adminMsg, 'html').catch(() => {});
            return;
        } else if (cleanText === '3') {
            // Cancel booking
            delete zaloSessions[chatId];
            await zaloBotService.sendMessage(chatId, '❌ Bạn đã hủy bỏ đăng ký đặt lịch này. Gõ "start" để quay lại menu chính.');
            return;
        } else {
            return zaloBotService.sendMessage(chatId, '❌ Lựa chọn phương thức thanh toán không hợp lệ. Vui lòng nhập lại số tương ứng (1, 2 hoặc 3):');
        }
    }
}

module.exports = {
    handleZaloMessage
};
