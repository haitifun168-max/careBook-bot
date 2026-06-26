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
        const db = require('../src/database');
        await db.initPromise;

        // Configure test configurations
        config.ZALO_BOT_TOKEN = 'test_zalo_token_123';
        config.ZALO_BOT_SECRET_TOKEN = 'test_zalo_secret_token_123';
        config.ADMIN_ID = '99999999';
        config.WEBHOOK_PORT = 0; // OS assigns random free port

        // Ensure admin user exists in DB
        const userService = require('../src/services/userService');
        await userService.findOrCreate({
            id: config.ADMIN_ID,
            username: 'admin_test',
            first_name: 'Admin',
            last_name: 'Test'
        });

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
            const body = options && options.body ? JSON.parse(options.body) : null;
            lastFetchCall = { 
                url, 
                options: options ? { ...options, body } : null 
            };
            if (globalThis.fetchCalls) {
                globalThis.fetchCalls.push(lastFetchCall);
            }
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
        globalThis.fetchCalls = [];
    });

    test.after(async () => {
        // Restore fetch
        globalThis.fetch = originalFetch;

        // Clean up test admin user from DB
        const db = require('../src/database');
        await db.query('DELETE FROM users WHERE telegram_id = $1', [String(config.ADMIN_ID)]);

        // Close DB pool
        await db.end();

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

    test('POST /webhook/zalo text booking command Đặt lịch triggers booking flow and welcome message', async () => {
        const payload = {
            update_id: 1001,
            message: {
                message_id: 890,
                chat: {
                    id: '123456789'
                },
                text: 'Đặt lịch',
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
        assert.ok(lastFetchCall.options.body.text.includes('DANH SÁCH DỊCH VỤ & GÓI KHÁM'));

        // Dọn dẹp session bằng cách gửi "huy"
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123'
            },
            body: JSON.stringify({
                update_id: 1002,
                message: {
                    message_id: 891,
                    chat: { id: '123456789' },
                    text: 'huy',
                    from: { id: '123456789' }
                }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
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
        assert.ok(lastFetchCall.options.body.text.includes(config.PAYMENT_PREFIX || 'CB'));
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

    test('POST /webhook/zalo parses user_send_business_card event payload', async () => {
        const chatId = '777888999';

        // 1. Start booking flow first
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 4000,
                message: { message_id: 400, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 2. Select package 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 4001,
                message: { message_id: 401, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 3. Select date 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 4002,
                message: { message_id: 402, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 4. Select slot 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 4003,
                message: { message_id: 403, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 5. Select patient type self (1)
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 4004,
                message: { message_id: 404, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Send business card payload
        const businessCardPayload = {
            event_name: 'user_send_business_card',
            sender: {
                id: chatId
            },
            message: {
                msg_id: 'msg_bc_123',
                attachments: [
                    {
                        type: 'business_card',
                        payload: {
                            phone: '0977666555',
                            display_name: 'Minh An'
                        }
                    }
                ]
            }
        };

        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify(businessCardPayload)
        });
        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.ok(lastFetchCall);
        assert.ok(lastFetchCall.options.body.text.includes('BẢNG XÁC NHẬN THÔNG TIN ĐẶT LỊCH HẸN'));
        assert.ok(lastFetchCall.options.body.text.includes('Minh An'));
        assert.ok(lastFetchCall.options.body.text.includes('0977666555'));

        // Clean up session
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 4006,
                message: { message_id: 406, chat: { id: chatId }, text: 'huy', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
    });

    test('POST /webhook/zalo extracts phone number from Zalo profile URL in text', async () => {
        const chatId = '555444333';

        // 1. Start booking flow
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 5000,
                message: { message_id: 500, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 2. Select package 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 5001,
                message: { message_id: 501, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 3. Select date 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 5002,
                message: { message_id: 502, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 4. Select slot 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 5003,
                message: { message_id: 503, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 5. Select patient type self (1)
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 5004,
                message: { message_id: 504, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 5b. Send patient name
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 5007,
                message: { message_id: 507, chat: { id: chatId }, text: 'Nguyễn Văn A', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 6. Send phone number as Zalo URL in text
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 5005,
                message: { message_id: 505, chat: { id: chatId }, text: 'https://zalo.me/0912345678', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.ok(lastFetchCall);
        assert.ok(lastFetchCall.options.body.text.includes('BẢNG XÁC NHẬN THÔNG TIN ĐẶT LỊCH HẸN'));
        assert.ok(lastFetchCall.options.body.text.includes('Nguyễn Văn A'));
        assert.ok(lastFetchCall.options.body.text.includes('0912345678'));

        // Clean up session
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 5006,
                message: { message_id: 506, chat: { id: chatId }, text: 'huy', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
    });

    test('POST /webhook/zalo extracts phone number from link attachment', async () => {
        const chatId = '666555444';

        // 1. Start booking flow
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 6000,
                message: { message_id: 600, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 2. Select package 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 6001,
                message: { message_id: 601, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 3. Select date 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 6002,
                message: { message_id: 602, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 4. Select slot 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 6003,
                message: { message_id: 603, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 5. Select patient type self (1)
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 6004,
                message: { message_id: 604, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 5b. Send patient name
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 6007,
                message: { message_id: 607, chat: { id: chatId }, text: 'Nguyễn Văn A', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 6. Send link attachment (e.g. user_send_link event)
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                event_name: 'user_send_link',
                sender: { id: chatId },
                message: {
                    msg_id: 'msg_link_123',
                    attachments: [
                        {
                            type: 'link',
                            payload: {
                                url: 'https://zalo.me/0922333444'
                            }
                        }
                    ]
                }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.ok(lastFetchCall);
        assert.ok(lastFetchCall.options.body.text.includes('BẢNG XÁC NHẬN THÔNG TIN ĐẶT LỊCH HẸN'));
        assert.ok(lastFetchCall.options.body.text.includes('Nguyễn Văn A'));
        assert.ok(lastFetchCall.options.body.text.includes('0922333444'));

        // Clean up session
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 6006,
                message: { message_id: 606, chat: { id: chatId }, text: 'huy', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
    });

    test('POST /webhook/zalo extracts phone number from user_submit_info event', async () => {
        const chatId = '888222111';

        // 1. Start booking flow
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 7000,
                message: { message_id: 700, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 2. Select package 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 7001,
                message: { message_id: 701, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 3. Select date 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 7002,
                message: { message_id: 702, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 4. Select slot 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 7003,
                message: { message_id: 703, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 5. Select patient type self (1)
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 7004,
                message: { message_id: 704, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 6. Send user_submit_info event
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                event_name: 'user_submit_info',
                sender: { id: chatId },
                info: {
                    name: 'Test Patient',
                    phone: '84933222111'
                }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.ok(lastFetchCall);
        assert.ok(lastFetchCall.options.body.text.includes('BẢNG XÁC NHẬN THÔNG TIN ĐẶT LỊCH HẸN'));
        // 84933222111 normalized is 0933222111
        assert.ok(lastFetchCall.options.body.text.includes('0933222111'));

        // Clean up session
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 7006,
                message: { message_id: 706, chat: { id: chatId }, text: 'huy', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
    });

    test('POST /webhook/zalo Case 4: Invalid phone number entry and retry', async () => {
        const chatId = '999888777';

        // 1. Start booking flow
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8000,
                message: { message_id: 800, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 2. Select package 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8001,
                message: { message_id: 801, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 3. Select date 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8002,
                message: { message_id: 802, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 4. Select slot 1
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8003,
                message: { message_id: 803, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 5. Select patient type other (2)
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8004,
                message: { message_id: 804, chat: { id: chatId }, text: '2', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(lastFetchCall.options.body.text.includes('Họ tên đầy đủ'));

        // 6. Enter name "Nguyễn Văn C"
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8005,
                message: { message_id: 805, chat: { id: chatId }, text: 'Nguyễn Văn C', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(lastFetchCall.options.body.text.includes('Số điện thoại'));

        // 7. Enter invalid phone "12345"
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8006,
                message: { message_id: 806, chat: { id: chatId }, text: '12345', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(lastFetchCall.options.body.text.includes('Số điện thoại không hợp lệ'));

        // 8. Enter invalid phone with letters "0912abc345"
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8007,
                message: { message_id: 807, chat: { id: chatId }, text: '0912abc345', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(lastFetchCall.options.body.text.includes('Số điện thoại không hợp lệ'));

        // 9. Enter valid phone "0912345678*"
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8008,
                message: { message_id: 808, chat: { id: chatId }, text: '0912345678*', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(lastFetchCall.options.body.text.includes('XÁC NHẬN THÔNG TIN ĐẶT LỊCH HẸN'));
        assert.ok(lastFetchCall.options.body.text.includes('Nguyễn Văn C'));
        assert.ok(lastFetchCall.options.body.text.includes('0912345678'));

        // Clean up session
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8009,
                message: { message_id: 809, chat: { id: chatId }, text: 'huy', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
    });

    test('POST /webhook/zalo processes message.unsupported.received event and handles user feedback', async () => {
        const chatId = '999888777';

        // 1. Test unsupported message when NO active session
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8500,
                event_name: 'message.unsupported.received',
                message: {
                    message_id: 850,
                    chat: { id: chatId },
                    from: { id: chatId }
                }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(globalThis.fetchCalls.length > 0);
        assert.ok(globalThis.fetchCalls.some(call => call.options && call.options.body && call.options.body.text && call.options.body.text.includes('Định dạng tin nhắn không được hỗ trợ')));

        // Reset calls for step 2
        globalThis.fetchCalls = [];

        // 2. Start booking flow and progress to WAITING_PATIENT_PHONE
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8501,
                message: { message_id: 851, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8502,
                message: { message_id: 852, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8503,
                message: { message_id: 853, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8504,
                message: { message_id: 854, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8505,
                message: { message_id: 855, chat: { id: chatId }, text: '1', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8506,
                message: { message_id: 856, chat: { id: chatId }, text: 'Kevin Test', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(globalThis.fetchCalls.some(call => call.options && call.options.body && call.options.body.text && call.options.body.text.includes('Số điện thoại liên hệ')));

        // Reset calls for step 3
        globalThis.fetchCalls = [];

        // 3. Send message.unsupported.received (simulate sharing contact)
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8507,
                event_name: 'message.unsupported.received',
                message: {
                    message_id: 857,
                    chat: { id: chatId },
                    from: { id: chatId }
                }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        
        assert.ok(globalThis.fetchCalls.some(call => call.options && call.options.body && call.options.body.text && call.options.body.text.includes('Phương thức chia sẻ danh bạ/số điện thoại tự động')));

        // Clean up session
        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123' },
            body: JSON.stringify({
                update_id: 8508,
                message: { message_id: 858, chat: { id: chatId }, text: 'huy', from: { id: chatId } }
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
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

