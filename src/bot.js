const { Telegraf } = require('telegraf');
const config = require('./config');

// Validate token
if (!config.BOT_TOKEN || config.BOT_TOKEN === 'your_bot_token_here') {
    console.error('❌ BOT_TOKEN chưa được cấu hình! Hãy cập nhật file .env');
    process.exit(1);
}

const bot = new Telegraf(config.BOT_TOKEN);

// Debug logging middleware
const fs = require('fs');
const path = require('path');
const debugLogPath = path.join(__dirname, 'debug.log');
fs.writeFileSync(debugLogPath, '--- Bot debug log initialized ---\n');

bot.use((ctx, next) => {
    const logMsg = `[Debug Update] Type: ${ctx.updateType} | From: ${ctx.from?.id} (${ctx.from?.username}) | Text/Data: ${ctx.message?.text || ctx.callbackQuery?.data || 'None'}`;
    console.log(logMsg);
    fs.appendFileSync(debugLogPath, logMsg + '\n');
    return next();
});

// Error handler
bot.catch((err, ctx) => {
    console.error(`❌ Error for ${ctx.updateType}:`, err.message);
    try {
        if (ctx.callbackQuery) {
            ctx.answerCbQuery('❌ Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.').catch(() => {});
        }
        ctx.reply('❌ Đã xảy ra lỗi. Vui lòng thử lại sau.').catch(() => {});
    } catch (e) {
        // ignore
    }
});

// Register commands
require('./commands/start')(bot);
require('./commands/menu')(bot);
require('./commands/product')(bot);
require('./commands/nap')(bot);
require('./commands/checkpay')(bot);
require('./commands/support')(bot);
require('./commands/myid')(bot);

// Register handlers
require('./handlers/bookingWizard')(bot);
require('./handlers/adminActions')(bot);

// Set bot commands for menu
bot.telegram.setMyCommands([
    { command: 'start', description: '📅 Đặt lịch khám mới' },
    { command: 'menu', description: '👤 Thông tin bệnh nhân' },
    { command: 'product', description: '🩺 Danh sách gói khám/dịch vụ' },
    { command: 'nap', description: '💰 Nạp ví tích điểm' },
    { command: 'checkpay', description: '🔍 Lịch khám của bạn' },
    { command: 'support', description: '🆘 Hỗ trợ y tế' },
    { command: 'myid', description: '🆔 Lấy ID Telegram của bạn' },
]);

// Import appointment service for startup cleanup
const appointmentService = require('./services/appointmentService');

// Post-launch successful setup tasks
const runStartupTasks = () => {
    console.log(`🤖 ${config.SHOP_NAME} Bot đã sẵn sàng!`);
    console.log(`👤 Admin ID: ${config.ADMIN_ID}`);
    console.log(`🏦 Bank: ${config.BANK.NAME} - ${config.BANK.ACCOUNT}`);
    
    // Cleanup expired appointments on startup
    appointmentService.cleanupExpiredAppointments()
        .then(() => {
            console.log('🧹 Đã dọn dẹp các lịch hẹn chờ cọc hết hạn lúc khởi động.');
        })
        .catch((e) => {
            console.error('⚠️ Không thể dọn dẹp lịch hẹn hết hạn:', e.message);
        });

    // Run background jobs every 1 minute
    setInterval(async () => {
        try {
            await appointmentService.cleanupExpiredAppointments();
        } catch (e) {
            console.error('⚠️ Lỗi dọn dẹp lịch hẹn hết hạn:', e.message);
        }

        try {
            await appointmentService.sendBookingReminders(bot);
        } catch (e) {
            console.error('⚠️ Lỗi gửi nhắc nhở đặt lịch:', e.message);
        }
    }, 60000);
    
    // Fetch and save bot username dynamically
    bot.telegram.getMe().then((me) => {
        config.BOT_USERNAME = me.username;
        console.log(`👤 Bot Username: @${me.username}`);
    }).catch((err) => {
        console.error('⚠️ Không thể lấy thông tin Bot Username:', err.message);
    });
};

// Check if PUBLIC_URL is configured and starts with https:// (Render/Production webhook mode)
if (config.PUBLIC_URL && config.PUBLIC_URL.startsWith('https://')) {
    const telegramSecretPath = `/webhook/telegram-${config.BOT_TOKEN.slice(0, 10)}`;
    const webhookUrl = `${config.PUBLIC_URL.replace(/\/$/, '')}${telegramSecretPath}`;
    
    bot.telegram.setWebhook(webhookUrl)
        .then(() => {
            console.log(`🤖 Telegram Bot đang chạy ở chế độ WEBHOOK!`);
            console.log(`🔗 Webhook URL: ${webhookUrl}`);
            runStartupTasks();
        })
        .catch((err) => {
            console.error('❌ Không thể cấu hình Telegram Webhook:', err.message);
            console.error('💡 Kiểm tra lại BOT_TOKEN trong file .env hoặc kết nối mạng.');
            process.exit(1);
        });
} else {
    // Local / Development polling mode
    bot.launch()
        .then(() => {
            console.log(`🤖 Telegram Bot đang chạy ở chế độ POLLING (getUpdates)!`);
            runStartupTasks();
        })
        .catch((err) => {
            console.error('❌ Không thể khởi động bot ở chế độ Polling:', err.message);
            console.error('💡 Kiểm tra lại BOT_TOKEN trong file .env');
            process.exit(1);
        });
}

// Start Webhook server
const { startWebhookServer } = require('./services/webhookService');
startWebhookServer(bot);

// Prevent crash on network errors
process.on('unhandledRejection', (err) => {
    console.error('⚠️ Unhandled rejection (ignored):', err.message || err);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught exception:', err.message || err);
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        console.log('🔄 Network error, bot continues running...');
        return; // Don't crash on network errors
    }
    process.exit(1);
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
