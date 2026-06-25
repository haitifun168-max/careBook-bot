const appointmentService = require('../services/appointmentService');
const productService = require('../services/productService');
const paymentService = require('../services/paymentService');
const userService = require('../services/userService');
const calendarService = require('../services/calendarService');
const config = require('../config');
const messages = require('../utils/messages');
const { Markup } = require('telegraf');
const { 
    dateSelectionKeyboard, 
    timeSlotKeyboard, 
    bookingTargetKeyboard, 
    phoneVerificationKeyboard, 
    bookingConfirmKeyboard, 
    postBookingKeyboard,
    mainMenuKeyboard,
    formatPrice
} = require('../utils/keyboard');

// In-memory session store for the wizard
const userSessions = {};

/**
 * Helper to get or initialize session
 */
function getSession(userId) {
    if (!userSessions[userId]) {
        userSessions[userId] = {
            state: null,
            productId: null,
            dateStr: null,
            hourId: null,
            patientType: null,
            patientName: null,
            patientPhone: null,
        };
    }
    return userSessions[userId];
}

/**
 * Helper to clear session
 */
function clearSession(userId) {
    delete userSessions[userId];
}

module.exports = (bot) => {
    // 1. Initiate booking from product list click (replaces old click behavior)
    bot.action(/^product_(\d+)$/, async (ctx) => {
        const productId = parseInt(ctx.match[1]);
        const product = productService.getById(productId);

        if (!product) {
            return ctx.answerCbQuery('❌ Gói dịch vụ không tồn tại');
        }

        ctx.answerCbQuery();

        if (product.contact_only) {
            const buttons = [];
            const supportUsername = require('../config').SUPPORT_CONTACT.replace('@', '');
            buttons.push([Markup.button.url('💬 Liên hệ tư vấn', `https://t.me/${supportUsername}`)]);
            if (product.contact_url) {
                buttons.push([Markup.button.url('📱 Hotline Zalo', product.contact_url)]);
            }
            buttons.push([Markup.button.callback('↩️ Quay lại', 'refresh_products')]);

            return ctx.replyWithHTML(
                messages.contactOnly(product),
                Markup.inlineKeyboard(buttons)
            );
        }

        // Initialize session
        const session = getSession(ctx.from.id);
        session.state = 'SELECT_DATE';
        session.productId = productId;

        ctx.editMessageText(`🩺 <b>Gói dịch vụ: ${product.name}</b>\n\n${messages.productHeader}`, {
            parse_mode: 'HTML',
            ...dateSelectionKeyboard(productId)
        }).catch(() => {
            ctx.replyWithHTML(`🩺 <b>Gói dịch vụ: ${product.name}</b>\n\n${messages.productHeader}`, dateSelectionKeyboard(productId));
        });
    });

    // 2. Handle Date selection
    bot.action(/^date_(\d+)_([\d-]+)$/, async (ctx) => {
        const productId = parseInt(ctx.match[1]);
        const dateStr = ctx.match[2];
        const product = productService.getById(productId);

        if (!product) {
            return ctx.answerCbQuery('❌ Dịch vụ không tồn tại');
        }

        ctx.answerCbQuery();

        const session = getSession(ctx.from.id);
        session.state = 'SELECT_TIME';
        session.productId = productId;
        session.dateStr = dateStr;

        // Fetch slots & counts
        const clinicHours = appointmentService.getClinicHours();
        const occupiedCounts = appointmentService.getOccupiedSlotCounts(dateStr);

        ctx.editMessageText(`🩺 Gói: <b>${product.name}</b>\n📅 Ngày khám: <b>${dateStr}</b>\n\n👇 Chọn khung giờ khám trống dưới đây:`, {
            parse_mode: 'HTML',
            ...timeSlotKeyboard(productId, dateStr, clinicHours, occupiedCounts)
        }).catch(() => {
            ctx.replyWithHTML(`🩺 Gói: <b>${product.name}</b>\n📅 Ngày khám: <b>${dateStr}</b>\n\n👇 Chọn khung giờ khám trống dưới đây:`, 
                timeSlotKeyboard(productId, dateStr, clinicHours, occupiedCounts)
            );
        });
    });

    // Handle full slot warning
    bot.action('slot_full', (ctx) => {
        ctx.answerCbQuery('❌ Khung giờ này đã đủ số lượng đặt chỗ. Vui lòng chọn giờ khác.', true);
    });

    // 3. Handle Time Slot selection
    bot.action(/^slot_(\d+)_([\d-]+)_(\d+)$/, async (ctx) => {
        const productId = parseInt(ctx.match[1]);
        const dateStr = ctx.match[2];
        const hourId = parseInt(ctx.match[3]);

        ctx.answerCbQuery();

        const session = getSession(ctx.from.id);
        session.productId = productId;
        session.dateStr = dateStr;
        session.hourId = hourId;
        session.state = 'ASK_PATIENT_TYPE';

        const hour = appointmentService.getClinicHourById(hourId);
        if (!hour) return ctx.reply('❌ Khung giờ không hợp lệ.');

        ctx.editMessageText(`📅 Lịch đặt: Ngày <b>${dateStr}</b> lúc <b>${hour.time_label}</b>\n\n❓ Bạn muốn đăng ký đặt lịch khám cho ai?`, {
            parse_mode: 'HTML',
            ...bookingTargetKeyboard(productId, dateStr, hourId)
        }).catch(() => {
            ctx.replyWithHTML(`📅 Lịch đặt: Ngày <b>${dateStr}</b> lúc <b>${hour.time_label}</b>\n\n❓ Bạn muốn đăng ký đặt lịch khám cho ai?`, 
                bookingTargetKeyboard(productId, dateStr, hourId)
            );
        });
    });

    // 4. Handle Self Booking Target
    bot.action(/^target_self_(\d+)_([\d-]+)_(\d+)$/, async (ctx) => {
        ctx.answerCbQuery();
        const session = getSession(ctx.from.id);
        session.patientType = 'self';
        session.state = 'WAITING_PATIENT_CONTACT';

        // Save name from Telegram
        session.patientName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || ctx.from.username || 'Khách hàng';

        ctx.reply('📱 Để xác thực, vui lòng nhấn nút <b>"Chia sẻ số điện thoại xác thực"</b> bên dưới để tiếp tục:', {
            parse_mode: 'HTML',
            ...phoneVerificationKeyboard()
        });
    });

    // 5. Handle Other Booking Target
    bot.action(/^target_other_(\d+)_([\d-]+)_(\d+)$/, async (ctx) => {
        ctx.answerCbQuery();
        const session = getSession(ctx.from.id);
        session.patientType = 'other';
        session.state = 'WAITING_PATIENT_NAME';

        ctx.reply('👤 Vui lòng nhập <b>Họ tên</b> của bệnh nhân (người thân của bạn):', {
            parse_mode: 'HTML',
            reply_markup: { remove_keyboard: true } // clean reply keyboards
        });
    });

    // 6. Handle Cancel Booking
    bot.action('cancel_booking', (ctx) => {
        ctx.answerCbQuery('❌ Đã hủy bỏ');
        clearSession(ctx.from.id);
        ctx.editMessageText(messages.bookingCancelled).catch(() => ctx.reply(messages.bookingCancelled));
    });

    // Handle Wallet Payment Click
    bot.action(/^bk_pay_wallet_(\d+)$/, async (ctx) => {
        const userId = ctx.from.id;
        const session = getSession(userId);

        if (!session.productId || !session.hourId || !session.dateStr) {
            return ctx.answerCbQuery('❌ Phiên đặt lịch không hợp lệ hoặc đã hết hạn.');
        }

        const product = productService.getById(session.productId);
        const hour = appointmentService.getClinicHourById(session.hourId);

        if (!product || !hour) {
            return ctx.answerCbQuery('❌ Dịch vụ hoặc khung giờ không hợp lệ.');
        }

        // Check user balance
        const user = userService.get(userId);
        if (!user || user.balance < product.deposit_amount) {
            return ctx.answerCbQuery('❌ Số dư ví không đủ để thanh toán cọc.');
        }

        // Double check slot availability
        const available = appointmentService.isSlotAvailable(session.dateStr, hour.time_label, hour.max_capacity);
        if (!available) {
            ctx.answerCbQuery('❌ Khung giờ này vừa mới hết chỗ rảnh.', true);
            clearSession(userId);
            return ctx.reply(messages.noSlotsAvailable, postBookingKeyboard());
        }

        ctx.answerCbQuery('⏳ Đang thanh toán bằng ví...');

        // Deduct user balance
        userService.deductBalance(userId, product.deposit_amount);

        // Generate a unique wallet payment code
        const paymentCode = paymentService.generatePaymentCode('WALLET');

        // Create appointment in database (already confirmed!)
        const appointment = appointmentService.create({
            userId,
            packageId: session.productId,
            patientName: session.patientName,
            patientPhone: session.patientPhone,
            bookingDate: session.dateStr,
            bookingTime: hour.time_label,
            totalPrice: product.price,
            depositAmount: product.deposit_amount,
            paymentCode
        });

        // Sync to Google Calendar
        let calendarEventId = null;
        const syncResult = await calendarService.createEvent(appointment, product.name);
        if (syncResult.success) {
            calendarEventId = syncResult.eventId;
        }

        // Update appointment status to confirmed
        appointmentService.confirmPayment(appointment.id, calendarEventId);
        const confirmedAppt = appointmentService.getById(appointment.id);

        // Notify user of success
        await ctx.replyWithHTML(
            messages.bookingSuccess(confirmedAppt, product.name),
            postBookingKeyboard()
        );

        // Clear session
        clearSession(userId);

        // Notify Admin about new booking via Wallet
        const adminMsg = 
            `🔔 <b>LỊCH ĐẶT MỚI (ĐÃ CỌC QUA VÍ) #${appointment.id}</b>\n\n` +
            `🩺 Dịch vụ: <b>${product.name}</b>\n` +
            `👤 Bệnh nhân: <b>${appointment.patient_name}</b>\n` +
            `📱 SĐT: <code>${appointment.patient_phone}</code>\n` +
            `📅 Ngày khám: ${appointment.booking_date}\n` +
            `⏱️ Giờ khám: ${appointment.booking_time}\n` +
            `💵 Tiền cọc: <b>${formatPrice(product.deposit_amount)} (Ví)</b>\n` +
            `📅 Google Calendar Sync: ${calendarEventId ? '🟢 OK' : '⚠️ LỖI'}`;
            
        bot.telegram.sendMessage(config.ADMIN_ID, adminMsg, { parse_mode: 'HTML' }).catch(() => {});
    });

    // 7. Handle Confirmation Click
    bot.action(/^bk_confirm_(\d+)$/, async (ctx) => {
        const userId = ctx.from.id;
        const session = getSession(userId);

        if (!session.productId || !session.hourId || !session.dateStr) {
            return ctx.answerCbQuery('❌ Phiên đặt lịch không hợp lệ hoặc đã hết hạn.');
        }

        const product = productService.getById(session.productId);
        const hour = appointmentService.getClinicHourById(session.hourId);

        if (!product || !hour) {
            return ctx.answerCbQuery('❌ Dịch vụ hoặc khung giờ không hợp lệ.');
        }

        // Double check slot availability
        const available = appointmentService.isSlotAvailable(session.dateStr, hour.time_label, hour.max_capacity);
        if (!available) {
            ctx.answerCbQuery('❌ Khung giờ này vừa mới hết chỗ rảnh.', true);
            clearSession(userId);
            return ctx.reply(messages.noSlotsAvailable, postBookingKeyboard());
        }

        ctx.answerCbQuery('⏳ Đang tạo lịch hẹn...');

        // Register user if not exists
        userService.findOrCreate(ctx.from);

        // Generate payment details
        const paymentCode = paymentService.generatePaymentCode();
        const qrUrl = paymentService.generateQRUrl(product.deposit_amount, paymentCode);

        // Create appointment in database
        const appointment = appointmentService.create({
            userId,
            packageId: session.productId,
            patientName: session.patientName,
            patientPhone: session.patientPhone,
            bookingDate: session.dateStr,
            bookingTime: hour.time_label,
            totalPrice: product.price,
            depositAmount: product.deposit_amount,
            paymentCode
        });

        // Inform user
        await ctx.replyWithPhoto(qrUrl, {
            caption: messages.paymentInstructions(product.deposit_amount, paymentCode),
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ Hủy đặt lịch', `cancel_pending_${appointment.id}`)]
            ])
        });

        // Clear wizard state session
        clearSession(userId);

        // Notify Admin about new pending booking
        const adminMsg = 
            `🔔 <b>LỊCH ĐĂNG KÝ MỚI (CHỜ CỌC) #${appointment.id}</b>\n\n` +
            `🩺 Dịch vụ: <b>${product.name}</b>\n` +
            `👤 Bệnh nhân: <b>${appointment.patient_name}</b>\n` +
            `📱 SĐT: <code>${appointment.patient_phone}</code>\n` +
            `📅 Ngày khám: ${appointment.booking_date}\n` +
            `⏱️ Giờ khám: ${appointment.booking_time}\n` +
            `💵 Tiền cọc: <b>${formatPrice(product.deposit_amount)}</b>\n` +
            `🔑 Mã nội dung: <code>${paymentCode}</code>\n\n` +
            `⏱️ <i>Lịch giữ chỗ sẽ tự động hủy sau 15 phút nếu khách chưa chuyển khoản cọc.</i>`;
            
        bot.telegram.sendMessage(require('../config').ADMIN_ID, adminMsg, { parse_mode: 'HTML' }).catch(() => {});

        // 8. 15-Minute Expiration Timer
        setTimeout(async () => {
            try {
                const freshAppt = appointmentService.getById(appointment.id);
                if (freshAppt && freshAppt.status === 'pending') {
                    appointmentService.cancel(appointment.id);
                    
                    // Alert customer
                    await bot.telegram.sendMessage(
                        appointment.user_id,
                        messages.bookingExpired(product.name, appointment.booking_date, appointment.booking_time),
                        { parse_mode: 'HTML' }
                    );

                    // Notify Admin about auto-cancellation
                    const adminCancelMsg = 
                        `❌ <b>LỊCH HẸN TỰ HỦY DO HẾT HẠN CỌC #${appointment.id}</b>\n\n` +
                        `👤 Bệnh nhân: ${appointment.patient_name}\n` +
                        `📅 Ngày khám: ${appointment.booking_date} (${appointment.booking_time})\n` +
                        `🩺 Dịch vụ: ${product.name}`;
                    bot.telegram.sendMessage(require('../config').ADMIN_ID, adminCancelMsg, { parse_mode: 'HTML' }).catch(() => {});
                }
            } catch (err) {
                console.error(`Error in appointment #${appointment.id} expiration timer:`, err.message);
            }
        }, 15 * 60 * 1000);
    });

    // Handle cancel pending appointment by customer
    bot.action(/^cancel_pending_(\d+)$/, async (ctx) => {
        const appointmentId = parseInt(ctx.match[1]);
        const appointment = appointmentService.getById(appointmentId);

        if (!appointment) {
            return ctx.answerCbQuery('❌ Lịch hẹn không tồn tại');
        }

        if (appointment.status !== 'pending') {
            return ctx.answerCbQuery('⚠️ Lịch này đã được thanh toán hoặc đã hủy.');
        }

        ctx.answerCbQuery('❌ Đã hủy lịch');
        appointmentService.cancel(appointmentId);

        ctx.editMessageText('❌ Bạn đã chủ động hủy yêu cầu đặt lịch hẹn này. Khung giờ đã được giải phóng.', {
            reply_markup: postBookingKeyboard()
        }).catch(() => {
            ctx.reply('❌ Bạn đã chủ động hủy yêu cầu đặt lịch hẹn này.');
        });

        // Notify Admin
        const adminCancelMsg = 
            `❌ <b>KHÁCH CHỦ ĐỘNG HỦY LỊCH CHỜ CỌC #${appointmentId}</b>\n\n` +
            `👤 Bệnh nhân: ${appointment.patient_name}\n` +
            `📅 Ngày khám: ${appointment.booking_date} (${appointment.booking_time})`;
        bot.telegram.sendMessage(require('../config').ADMIN_ID, adminCancelMsg, { parse_mode: 'HTML' }).catch(() => {});
    });

    // 9. Handle Shared Contact Message (State: WAITING_PATIENT_CONTACT)
    bot.on('contact', async (ctx) => {
        const userId = ctx.from.id;
        const session = getSession(userId);

        if (session.state !== 'WAITING_PATIENT_CONTACT') {
            return; // Not expecting contact
        }

        // Extract phone number
        let phone = ctx.message.contact.phone_number;
        // Clean phone number formats
        if (phone.startsWith('+')) phone = phone.substring(1);
        if (phone.startsWith('84') && phone.length > 10) phone = '0' + phone.substring(2);

        session.patientPhone = phone;
        session.state = 'CONFIRMATION';

        // Clean up keyboard
        await ctx.reply('✅ Đã xác thực số điện thoại thành công.', {
            reply_markup: { remove_keyboard: true }
        });

        showBookingConfirmation(ctx, session);
    });

    // 10. Handle Text Messages (States: WAITING_PATIENT_NAME, WAITING_PATIENT_PHONE)
    bot.on('text', async (ctx, next) => {
        const userId = ctx.from.id;
        const session = userSessions[userId];

        if (!session || !session.state) {
            return next(); // Pass to commands
        }

        const text = ctx.message.text.trim();

        if (text.startsWith('/')) {
            // Cancel current session if user issues a command
            clearSession(userId);
            return next();
        }

        if (session.state === 'WAITING_PATIENT_NAME') {
            if (text.length < 2) {
                return ctx.reply('❌ Họ tên quá ngắn. Vui lòng nhập đầy đủ họ và tên bệnh nhân:');
            }
            session.patientName = text;
            session.state = 'WAITING_PATIENT_PHONE';
            return ctx.reply('📞 Vui lòng nhập <b>Số điện thoại</b> liên hệ của bệnh nhân (Ví dụ: 0912345678):', {
                parse_mode: 'HTML'
            });
        }

        if (session.state === 'WAITING_PATIENT_PHONE') {
            // Simple regex validate: starts with 0 or 84, followed by 9 to 10 digits
            const phoneRegex = /^(0|84)\d{9,10}$/;
            if (!phoneRegex.test(text)) {
                return ctx.reply('❌ Số điện thoại không hợp lệ. Vui lòng nhập số điện thoại gồm 10 chữ số (Ví dụ: 0912345678):');
            }
            
            let phone = text;
            if (phone.startsWith('84')) phone = '0' + phone.substring(2);

            session.patientPhone = phone;
            session.state = 'CONFIRMATION';

            showBookingConfirmation(ctx, session);
        }
    });

    /**
     * Show booking confirmation card
     */
    function showBookingConfirmation(ctx, session) {
        const product = productService.getById(session.productId);
        const hour = appointmentService.getClinicHourById(session.hourId);

        if (!product || !hour) {
            clearSession(ctx.from.id);
            return ctx.reply('❌ Đã xảy ra lỗi trong quá trình chọn dịch vụ. Vui lòng thử lại.');
        }

        const user = userService.get(ctx.from.id);
        const hasEnoughBalance = user && user.balance >= product.deposit_amount;

        ctx.replyWithHTML(
            messages.bookingDetails(
                product.name,
                session.patientName,
                session.patientPhone,
                session.dateStr,
                hour.time_label,
                product.deposit_amount
            ),
            bookingConfirmKeyboard(ctx.from.id, hasEnoughBalance)
        );
    }
};
