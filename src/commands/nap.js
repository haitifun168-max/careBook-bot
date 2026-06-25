const paymentService = require('../services/paymentService');
const messages = require('../utils/messages');
const { formatPrice } = require('../utils/keyboard');
const userService = require('../services/userService');
const db = require('../database');

const napSessions = {};

module.exports = (bot) => {
    const executeNap = (ctx, amount) => {
        if (amount < 10000) {
            return ctx.reply('❌ Số tiền tối thiểu là 10.000đ');
        }

        // Ensure user exists in database
        userService.findOrCreate(ctx.from);

        const payment = paymentService.generatePayment(amount);

        // Record deposit request in database
        db.prepare('INSERT INTO deposits (user_id, amount, payment_code) VALUES (?, ?, ?)')
          .run(ctx.from.id, amount, payment.paymentCode);

        // Send QR image
        ctx.replyWithPhoto(payment.qrUrl, {
            caption:
                `💰 <b>NẠP SỐ DƯ VÍ TÍCH ĐIỂM</b>\n\n` +
                `Quét mã QR để nạp ${formatPrice(amount)} vào tài khoản.\n\n` +
                `🏦 Quét mã QR để chuyển khoản\n` +
                `├ Số tiền: <b>${formatPrice(amount)}</b>\n` +
                `└ Nội dung CK: <code>${payment.paymentCode}</code>\n\n` +
                `⏳ Sau khi chuyển khoản, số dư sẽ được cập nhật tự động.`,
            parse_mode: 'HTML',
        });
    };

    const handleNap = (ctx, amountStr) => {
        if (!amountStr) {
            // Set session state to wait for amount input
            napSessions[ctx.from.id] = { state: 'WAITING_AMOUNT' };
            return ctx.replyWithHTML(
                '💰 <b>NẠP SỐ DƯ VÍ TÍCH ĐIỂM</b>\n\n' +
                'Vui lòng nhập số tiền bạn muốn nạp (tối thiểu 10.000đ):\n' +
                '<i>Ví dụ: 50000</i>'
            );
        }

        if (isNaN(amountStr)) {
            return ctx.replyWithHTML(
                '❌ Số tiền không hợp lệ.\n' +
                'Cách dùng: /nap [số tiền]\n' +
                'Ví dụ: /nap 50000'
            );
        }

        executeNap(ctx, parseInt(amountStr));
    };

    bot.command('nap', (ctx) => {
        const text = ctx.message.text.split(' ');
        handleNap(ctx, text[1]);
    });

    bot.hears('💰 Nạp tiền', (ctx) => {
        handleNap(ctx, null);
    });

    // Handle text input for WAITING_AMOUNT state
    bot.on('text', async (ctx, next) => {
        const userId = ctx.from.id;
        const session = napSessions[userId];

        if (session && session.state === 'WAITING_AMOUNT') {
            const text = ctx.message.text.trim();
            
            // If user enters a command, cancel the deposit session
            if (text.startsWith('/')) {
                delete napSessions[userId];
                return next();
            }

            if (isNaN(text)) {
                return ctx.reply('❌ Số tiền phải là một con số. Vui lòng nhập lại số tiền muốn nạp:');
            }

            const amount = parseInt(text);
            delete napSessions[userId]; // clear session
            
            return executeNap(ctx, amount);
        }

        return next();
    });
};
