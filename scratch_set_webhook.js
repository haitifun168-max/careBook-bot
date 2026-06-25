const config = require('./src/config');
const zaloBotService = require('./src/services/zaloBotService');

async function registerWebhook() {
    const webhookUrl = 'https://carebook-bot.onrender.com/webhook/zalo';
    const secretToken = config.ZALO_BOT_SECRET_TOKEN;

    console.log(`🔄 Đang đăng ký Webhook URL lên Zalo: ${webhookUrl}`);
    console.log(`🔑 Secret Token: ${secretToken}`);

    try {
        const response = await zaloBotService.callApi('setWebhook', {
            url: webhookUrl,
            secret_token: secretToken
        });
        console.log('✅ Đăng ký Webhook thành công! Phản hồi từ Zalo:', JSON.stringify(response, null, 2));
    } catch (error) {
        console.error('❌ Đăng ký Webhook thất bại:', error.message);
    }
}

registerWebhook();
