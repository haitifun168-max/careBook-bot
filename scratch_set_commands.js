const zaloBotService = require('./src/services/zaloBotService');

async function setBotCommands() {
    console.log('🔄 Đang đăng ký danh sách lệnh "/" lên Zalo Bot...');
    const commandsList = [
        { command: 'start', description: '📅 Đặt lịch khám mới' },
        { command: 'menu', description: '👤 Thông tin bệnh nhân & ví' },
        { command: 'product', description: '🩺 Danh sách gói khám' },
        { command: 'nap', description: '💰 Hướng dẫn nạp tiền vào ví' },
        { command: 'checkpay', description: '🔍 Danh sách lịch hẹn của bạn' },
        { command: 'support', description: '🆘 Hỗ trợ y tế & Liên hệ' },
        { command: 'myid', description: '🆔 Lấy ID Zalo cá nhân' }
    ];

    try {
        const response = await zaloBotService.callApi('setMyCommands', {
            commands: commandsList
        });
        console.log('✅ Đăng ký lệnh "/" thành công! Phản hồi từ Zalo:', JSON.stringify(response, null, 2));
    } catch (error) {
        console.error('❌ Đăng ký lệnh "/" thất bại:', error.message);
    }
}

setBotCommands();
