const config = require('../config');

class ZaloBotService {
    constructor() {
        this.baseUrl = 'https://bot-api.zaloplatforms.com';
    }

    /**
     * Gửi yêu cầu HTTP đến Zalo Bot API
     * @param {string} method - Tên phương thức API (ví dụ: 'sendMessage', 'getMe')
     * @param {object} payload - Dữ liệu gửi đi
     * @returns {Promise<object>} - Kết quả từ API
     */
    async callApi(method, payload = {}) {
        const token = config.ZALO_BOT_TOKEN;
        if (!token || token === 'your_zalo_bot_token_here') {
            throw new Error('ZALO_BOT_TOKEN chưa được cấu hình hoặc giá trị mặc định không hợp lệ trong file .env');
        }

        const url = `${this.baseUrl}/bot${token}/${method}`;
        
        try {
            console.log(`[ZaloBotService] Gọi API ${method} với payload:`, JSON.stringify(payload));
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`HTTP Error ${response.status}: ${errText}`);
            }

            const data = await response.json();
            console.log(`[ZaloBotService] Phản hồi từ API ${method}:`, JSON.stringify(data));

            // Zalo Bot API trả về cấu trúc tương tự Telegram: { ok: true/false, result/description }
            if (data && data.ok === false) {
                throw new Error(`Zalo API error: ${data.description || 'Unknown error'} (Code: ${data.error_code || 'N/A'})`);
            }

            return data;
        } catch (error) {
            console.error(`❌ [ZaloBotService] Lỗi khi gọi API ${method}:`, error.message);
            throw error;
        }
    }

    /**
     * Lấy thông tin cơ bản về bot
     * @returns {Promise<object>}
     */
    async getMe() {
        return this.callApi('getMe');
    }

    /**
     * Gửi tin nhắn văn bản đến người dùng hoặc nhóm
     * @param {string|number} chatId - ID cuộc trò chuyện nhận tin nhắn
     * @param {string} text - Nội dung tin nhắn
     * @param {string} [parseMode='markdown'] - Định dạng hiển thị ('markdown' hoặc 'html')
     * @returns {Promise<object>}
     */
    async sendMessage(chatId, text, parseMode = 'markdown') {
        if (!chatId) {
            throw new Error('Thiếu chatId để gửi tin nhắn');
        }
        if (!text) {
            throw new Error('Nội dung tin nhắn không được để trống');
        }

        return this.callApi('sendMessage', {
            chat_id: String(chatId),
            text: text,
            parse_mode: parseMode
        });
    }

    /**
     * Gửi tin nhắn hình ảnh
     * @param {string|number} chatId - ID cuộc trò chuyện nhận hình ảnh
     * @param {string} photoUrl - Đường dẫn hình ảnh công khai
     * @param {string} [caption] - Nội dung chú thích tin nhắn
     * @returns {Promise<object>}
     */
    async sendPhoto(chatId, photoUrl, caption = '') {
        if (!chatId) {
            throw new Error('Thiếu chatId để gửi hình ảnh');
        }
        if (!photoUrl) {
            throw new Error('Đường dẫn hình ảnh không được để trống');
        }

        return this.callApi('sendPhoto', {
            chat_id: String(chatId),
            photo: photoUrl,
            caption: caption
        });
    }
}

module.exports = new ZaloBotService();
