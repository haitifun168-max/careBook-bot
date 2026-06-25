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

    test('POST /webhook/zalo booking flow - selecting product and showing dates', async () => {
        // Gửi "1" để chọn đặt lịch
        const payloadStart = {
            update_id: 1000,
            message: {
                message_id: 889,
                chat: { id: '123456789' },
                text: '1',
                from: { first_name: 'Minh', last_name: 'An', id: '123456789' }
            }
        };

        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123'
            },
            body: JSON.stringify(payloadStart)
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.ok(lastFetchCall.options.body.text.includes('DANH SÁCH DỊCH VỤ & GÓI KHÁM'));

        // Gửi "1" để chọn gói khám đầu tiên
        const payloadSelectProduct = {
            update_id: 1001,
            message: {
                message_id: 890,
                chat: { id: '123456789' },
                text: '1',
                from: { first_name: 'Minh', last_name: 'An', id: '123456789' }
            }
        };

        await originalFetch(`${baseUrl}/webhook/zalo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Bot-Api-Secret-Token': 'test_zalo_secret_token_123'
            },
            body: JSON.stringify(payloadSelectProduct)
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.ok(lastFetchCall.options.body.text.includes('CHỌN NGÀY KHÁM MONG MUỐN'));
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
