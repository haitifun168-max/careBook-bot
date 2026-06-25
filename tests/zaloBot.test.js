const test = require('node:test');
const assert = require('node:assert');
const config = require('../src/config');
const zaloBotService = require('../src/services/zaloBotService');
const { startWebhookServer } = require('../src/services/webhookService');

test.describe('Zalo Chatbot Integration Tests', () => {
    let server;
    let baseUrl;
    let lastFetchCall = null;
    let originalFetch;

    test.before(async () => {
        // Configure test configurations
        config.ZALO_BOT_TOKEN = 'test_zalo_token_123';
        config.ZALO_BOT_SECRET_TOKEN = 'test_zalo_secret_token_123';
        config.WEBHOOK_PORT = 0; // OS assigns random free port

        // Start server with mock bot
        const mockBot = {};
        server = startWebhookServer(mockBot);

        await new Promise((resolve) => {
            if (server.listening) {
                resolve();
            } else {
                server.once('listening', resolve);
            }
        });
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;

        // Mock globalThis.fetch
        originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, options) => {
            // Keep track of internal mock requests
            lastFetchCall = { 
                url, 
                options: options ? { ...options, body: JSON.parse(options.body) } : null 
            };
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ ok: true, result: {} }),
                json: async () => ({ ok: true, result: {} })
            };
        };
    });

    test.beforeEach(() => {
        lastFetchCall = null;
    });

    test.after(async () => {
        // Restore fetch
        globalThis.fetch = originalFetch;

        // Stop server
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    test('ZaloBotService.sendMessage calls the correct API endpoint', async () => {
        const result = await zaloBotService.sendMessage('123456', 'Hello world');
        assert.ok(result.ok);
        assert.ok(lastFetchCall);
        assert.strictEqual(lastFetchCall.url, 'https://bot-api.zaloplatforms.com/bottest_zalo_token_123/sendMessage');
        assert.deepStrictEqual(lastFetchCall.options.body, {
            chat_id: '123456',
            text: 'Hello world',
            parse_mode: 'markdown'
        });
    });

    test('POST /webhook/zalo accepts valid webhook secret and returns main menu', async () => {
        const payload = {
            update_id: 999,
            message: {
                message_id: 888,
                chat: {
                    id: '123456789'
                },
                text: 'Xin chào phòng khám',
                from: {
                    first_name: 'Minh',
                    last_name: 'An',
                    id: '123456789'
                }
            }
        };

        // Gửi request bằng fetch thực tế của Node.js đến local server
        const response = await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123'
            },
            body: JSON.stringify(payload)
        });

        assert.strictEqual(response.status, 200);
        const data = await response.json();
        assert.strictEqual(data.ok, true);

        // Chờ xử lý bất đồng bộ
        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.ok(lastFetchCall, 'Nên gọi fetch đến Zalo API để phản hồi khách hàng');
        assert.strictEqual(lastFetchCall.url, 'https://bot-api.zaloplatforms.com/bottest_zalo_token_123/sendMessage');
        assert.strictEqual(lastFetchCall.options.body.chat_id, '123456789');
        assert.ok(lastFetchCall.options.body.text.includes('CHÀO MỪNG BẠN ĐẾN VỚI'));
    });

    test('POST /webhook/zalo greeting command start triggers welcome message', async () => {
        const payload = {
            update_id: 1000,
            message: {
                message_id: 889,
                chat: {
                    id: '123456789'
                },
                text: '/start',
                from: {
                    first_name: 'Minh',
                    last_name: 'An',
                    id: '123456789'
                }
            }
        };

        const response = await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123'
            },
            body: JSON.stringify(payload)
        });

        assert.strictEqual(response.status, 200);
        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.ok(lastFetchCall);
        assert.ok(lastFetchCall.options.body.text.includes('CHÀO MỪNG BẠN ĐẾN VỚI'));
    });

    test('POST /webhook/zalo menu items 2-7', async () => {
        const menuItems = [
            { text: '2', expected: 'thông tin bệnh nhân zalo' },
            { text: '3', expected: 'danh sách dịch vụ & gói khám' },
            { text: '4', expected: 'hướng dẫn nạp tiền vào ví' },
            { text: '5', expected: 'lịch hẹn' },
            { text: '6', expected: 'hỗ trợ y tế & thông tin phòng khám' },
            { text: '7', expected: 'zalo id của bạn là' }
        ];

        for (const item of menuItems) {
            const payload = {
                update_id: 1100,
                message: {
                    message_id: 900,
                    chat: { id: '123456789' },
                    text: item.text,
                    from: { first_name: 'Minh', last_name: 'An', id: '123456789' }
                }
            };

            const response = await originalFetch(`${baseUrl}/webhook/zalo`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123'
                },
                body: JSON.stringify(payload)
            });
            assert.strictEqual(response.status, 200);

            await new Promise((resolve) => setTimeout(resolve, 50));
            assert.ok(lastFetchCall);
            assert.ok(lastFetchCall.options.body.text.toLowerCase().includes(item.expected), `Expected text to contain: ${item.expected}`);
        }
    });

    test('POST /webhook/zalo Case 2: Complete booking flow (Venus, Date 3, Slot 1, Relative, VietQR)', async () => {
        const chatId = '987654321';
        
        // 1. Send "1" (dat lich)
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 2000,
                message: { message_id: 200, chat: { id: chatId }, text: '1', from: { id: chatId, first_name: 'Lan' } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(lastFetchCall.options.body.text.includes('DANH SÁCH DỊCH VỤ & GÓI KHÁM'));

        // 2. Select package 2 (Bọc răng sứ Venus)
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 2001,
                message: { message_id: 201, chat: { id: chatId }, text: '2', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(lastFetchCall.options.body.text.includes('Bọc răng sứ Venus'));
        assert.ok(lastFetchCall.options.body.text.includes('CHỌN NGÀY KHÁM MONG MUỐN'));

        // 3. Select date 3
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 2002,
                message: { message_id: 202, chat: { id: chatId }, text: '3', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(lastFetchCall.options.body.text.includes('CHỌN KHUNG GIỜ KHÁM TRỐNG'));

        // 4. Select hour slot 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 2003,
                message: { message_id: 203, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(lastFetchCall.options.body.text.includes('BẠN MUỐN ĐĂNG KÝ ĐẶT LỊCH KHÁM CHO AI'));

        // 5. Select relative "2"
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 2004,
                message: { message_id: 204, chat: { id: chatId }, text: '2', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(lastFetchCall.options.body.text.includes('Họ tên đầy đủ'));

        // 6. Enter name "Trần Thị B"
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 2005,
                message: { message_id: 205, chat: { id: chatId }, text: 'Trần Thị B', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(lastFetchCall.options.body.text.includes('Số điện thoại'));

        // 7. Enter phone "0988777666"
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 2006,
                message: { message_id: 206, chat: { id: chatId }, text: '0988777666', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(lastFetchCall.options.body.text.includes('XÁC NHẬN THÔNG TIN ĐẶT LỊCH HẸN'));
        assert.ok(lastFetchCall.options.body.text.includes('Trần Thị B'));
        assert.ok(lastFetchCall.options.body.text.includes('0988777666'));

        // 8. Select payment method 1 (VietQR cọc)
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 2007,
                message: { message_id: 207, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        
        // Assert QR instructions and admin notification are sent
        assert.ok(lastFetchCall.options.body.text.includes('LỊCH ĐĂNG KÝ MỚI'));
        assert.ok(lastFetchCall.options.body.text.includes('NAP PAY-'));
    });

    test('POST /webhook/zalo Case 3: Booking flow cancellation (huy)', async () => {
        const chatId = '11223344';
        
        // Start flow
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 3000,
                message: { message_id: 300, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(lastFetchCall.options.body.text.includes('DANH SÁCH DỊCH VỤ & GÓI KHÁM'));

        // Cancel
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 3001,
                message: { message_id: 301, chat: { id: chatId }, text: 'huy', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(lastFetchCall.options.body.text.includes('Bạn đã hủy bỏ tiến trình đặt lịch'));
    });

    test('POST /webhook/zalo rejects invalid webhook secret', async () => {
        const response = await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Bot-Api-Secret-Token': 'invalid_secret'
            },
            body: JSON.stringify({})
        });

        assert.strictEqual(response.status, 401);
    });
});
