const appointmentService = require('../services/appointmentService');
const messages = require('../utils/messages');
const { Markup } = require('telegraf');

module.exports = (bot) => {
    const handleCheckPay = (ctx) => {
        const appointments = appointmentService.getRecentByUser(ctx.from.id, 5);

        if (appointments.length === 0) {
            return ctx.reply('📋 Bạn chưa đăng ký lịch khám nào.');
        }

        let text = '🔍 <b>LỊCH HẸN KHÁM GẦN ĐÂY</b>\n\n';
        appointments.forEach((appt) => {
            text += messages.checkApptStatus(appt) + '\n\n━━━━━━━━━━━━━━━━━\n\n';
        });

        ctx.replyWithHTML(text);
    };

    bot.command('checkpay', handleCheckPay);
    bot.hears('🔍 Kiểm tra thanh toán', handleCheckPay);
    bot.hears('🔍 Lịch khám của bạn', handleCheckPay);
};
