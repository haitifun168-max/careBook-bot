const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/database');
const config = require('../src/config');
const { startWebhookServer, activeTempTokens } = require('../src/services/webhookService');
const userService = require('../src/services/userService');
const appointmentService = require('../src/services/appointmentService');
const calendarService = require('../src/services/calendarService');

// Mock Calendar Service
calendarService.createEvent = async (appointment, packageName) => {
    return { success: true, eventId: 'mock-event-id-999' };
};
calendarService.deleteEvent = async (eventId) => {
    return { success: true };
};

test.describe('WebhookService and Express API Tests', () => {
    let server;
    let baseUrl;
    const testUser = {
        id: 99999903,
        username: 'test_user_webhook',
        first_name: 'Nguyen Van',
        last_name: 'Webhook'
    };
    let product;

    const sentTelegramMessages = [];
    const mockBot = {
        telegram: {
            sendMessage: async (chatId, text, options) => {
                sentTelegramMessages.push({ chatId, text, options });
                return { message_id: 12345 };
            }
        }
    };

    test.before(async () => {
        // Prepare test database records
        userService.findOrCreate(testUser);
        product = db.prepare('SELECT * FROM products LIMIT 1').get();
        assert.ok(product, 'Must have a seeded product');

        // Configure test server port and auth key
        config.WEBHOOK_PORT = 0; // OS assigns random free port
        config.SEPAY_API_KEY = 'test-secret-key';
        config.ADMIN_ID = 99999903; // set admin ID to test user ID

        // Start server with mock bot
        server = startWebhookServer(mockBot);

        // Wait for server to start and obtain base URL
        await new Promise((resolve) => {
            if (server.listening) {
                resolve();
            } else {
                server.once('listening', resolve);
            }
        });
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
    });

    test.beforeEach(() => {
        // Clear collections and DB records for our test user
        db.prepare('DELETE FROM appointments WHERE user_id = ?').run(testUser.id);
        db.prepare('DELETE FROM deposits WHERE user_id = ?').run(testUser.id);
        db.prepare("DELETE FROM deposits WHERE payment_code IN ('CB-3BJMSZ5PVOJW4', 'CB-U9HBDMOJV9ZZ', 'CB3BJMSZ5PVOJW4', 'CBU9HBDMOJV9ZZ')").run();
        db.prepare('DELETE FROM deposits WHERE user_id = 530718471553674176').run();
        db.prepare('DELETE FROM users WHERE telegram_id = 530718471553674176').run();
        db.prepare('UPDATE users SET balance = 0 WHERE telegram_id = ?').run(testUser.id);
        sentTelegramMessages.length = 0;
    });

    test.after(async () => {
        // Clean up test user & appointments from DB
        db.prepare('DELETE FROM appointments WHERE user_id = ?').run(testUser.id);
        db.prepare('DELETE FROM deposits WHERE user_id = ?').run(testUser.id);
        db.prepare('DELETE FROM users WHERE telegram_id = ?').run(testUser.id);
        
        // Stop server
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    test('GET / - returns landing page or 404', async () => {
        const res = await fetch(`${baseUrl}/`);
        assert.ok(res.status === 200 || res.status === 404);
    });

    test('GET /api/public/products - returns active products and categories', async () => {
        const res = await fetch(`${baseUrl}/api/public/products`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.ok(Array.isArray(data.products));
        assert.ok(Array.isArray(data.categories));
    });

    test('POST /webhook/sepay - unauthorized with wrong API key', async () => {
        const res = await fetch(`${baseUrl}/webhook/sepay`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Apikey wrong-key'
            },
            body: JSON.stringify({ content: 'TEST WEBHOOK' })
        });
        assert.strictEqual(res.status, 401);
    });

    test('POST /webhook/sepay - test connection successfully', async () => {
        const res = await fetch(`${baseUrl}/webhook/sepay`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Apikey test-secret-key'
            },
            body: JSON.stringify({ content: 'SEPAY TEST CONNECTION' })
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.message, 'Test connection successful');
    });

    test('POST /webhook/sepay - confirms pending appointment', async () => {
        const paymentCode = 'NAP PAY-TEST1A';
        const apt = appointmentService.create({
            userId: testUser.id,
            packageId: product.id,
            patientName: 'Test Confirm Patient',
            patientPhone: '0900000000',
            bookingDate: '2026-10-10',
            bookingTime: '08:00 - 09:00',
            totalPrice: product.price,
            depositAmount: product.deposit_amount,
            paymentCode: paymentCode
        });

        const res = await fetch(`${baseUrl}/webhook/sepay`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Apikey test-secret-key'
            },
            body: JSON.stringify({
                content: `GD CK chuyen khoan dat coc ${paymentCode}`,
                transferAmount: product.deposit_amount
            })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);

        // Check DB state
        const updatedApt = appointmentService.getById(apt.id);
        assert.strictEqual(updatedApt.status, 'confirmed');
        assert.strictEqual(updatedApt.calendar_event_id, 'mock-event-id-999');

        // Check that bot messages were sent
        assert.ok(sentTelegramMessages.length >= 2, 'Should send Telegram notification to user and admin');
    });

    test('POST /webhook/sepay - late payment / cancelled slot available: restores appointment', async () => {
        const paymentCode = 'NAP PAY-TEST2B';
        const apt = appointmentService.create({
            userId: testUser.id,
            packageId: product.id,
            patientName: 'Test Restore Patient',
            patientPhone: '0900000000',
            bookingDate: '2026-10-10',
            bookingTime: '08:00 - 09:00',
            totalPrice: product.price,
            depositAmount: product.deposit_amount,
            paymentCode: paymentCode
        });

        // Cancel it to simulate late cọc
        appointmentService.cancel(apt.id);
        const checkCancelled = appointmentService.getById(apt.id);
        assert.strictEqual(checkCancelled.status, 'cancelled');

        const res = await fetch(`${baseUrl}/webhook/sepay`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Apikey test-secret-key'
            },
            body: JSON.stringify({
                content: `GD CK chuyen khoan tre han ${paymentCode}`,
                transferAmount: product.deposit_amount
            })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.message, `Appointment #${apt.id} recovered`);

        // Check restored
        const updatedApt = appointmentService.getById(apt.id);
        assert.strictEqual(updatedApt.status, 'confirmed');

        // Check notification mentions restoration
        const userMsg = sentTelegramMessages.find(m => m.chatId === testUser.id);
        assert.ok(userMsg.text.includes('KHÔI PHỤC'));
    });

    test('POST /webhook/sepay - late payment / cancelled slot full: refunds to wallet', async () => {
        const dateStr = '2026-11-11';
        const timeLabel = '09:00 - 10:00';
        const maxCapacity = 1;

        // Ensure max capacity is 1 in DB for timeLabel
        db.prepare('UPDATE clinic_hours SET max_capacity = 1 WHERE time_label = ?').run(timeLabel);

        const paymentCode = 'NAP PAY-TEST3C';
        const aptA = appointmentService.create({
            userId: testUser.id,
            packageId: product.id,
            patientName: 'Patient A',
            patientPhone: '0900000000',
            bookingDate: dateStr,
            bookingTime: timeLabel,
            totalPrice: product.price,
            depositAmount: product.deposit_amount,
            paymentCode: paymentCode
        });

        // Cancel appointment A (simulating timeout)
        appointmentService.cancel(aptA.id);

        // Book slot with Appointment B and confirm it, fully occupying the slot
        const aptB = appointmentService.create({
            userId: testUser.id,
            packageId: product.id,
            patientName: 'Patient B',
            patientPhone: '0900000001',
            bookingDate: dateStr,
            bookingTime: timeLabel,
            totalPrice: product.price,
            depositAmount: product.deposit_amount,
            paymentCode: 'NAP PAY-OTHER'
        });
        appointmentService.confirmPayment(aptB.id, 'gcal-other');

        // Slot should be full now
        assert.strictEqual(appointmentService.isSlotAvailable(dateStr, timeLabel, maxCapacity), false);

        // Webhook receives payment for cancelled appointment A
        const res = await fetch(`${baseUrl}/webhook/sepay`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Apikey test-secret-key'
            },
            body: JSON.stringify({
                content: `GD CK tre han bi day cho ${paymentCode}`,
                transferAmount: product.deposit_amount
            })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(data.success);
        assert.ok(data.message.includes('refunded to wallet'));

        // Appointment A remains cancelled
        const finalAptA = appointmentService.getById(aptA.id);
        assert.strictEqual(finalAptA.status, 'cancelled');

        // User wallet should be refunded
        const user = userService.get(testUser.id);
        assert.strictEqual(user.balance, product.deposit_amount);

        // Notification must contain wallet refund info
        const userMsg = sentTelegramMessages.find(m => m.chatId === testUser.id);
        assert.ok(userMsg.text.includes('HOÀN CỌC VÀO VÍ'));
    });

    test('POST /webhook/sepay - completes pending deposit and increases balance', async () => {
        const paymentCode = 'NAP PAY-DEP999';
        const depositAmount = 150000;

        // Insert pending deposit request
        db.prepare(`
            INSERT INTO deposits (user_id, amount, payment_code, status)
            VALUES (?, ?, ?, 'pending')
        `).run(testUser.id, depositAmount, paymentCode);

        // Request SePay Webhook
        const res = await fetch(`${baseUrl}/webhook/sepay`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Apikey test-secret-key'
            },
            body: JSON.stringify({
                content: `Nap vi ${paymentCode}`,
                transferAmount: depositAmount
            })
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);

        // Check deposit status in DB
        const deposit = db.prepare('SELECT * FROM deposits WHERE payment_code = ?').get(paymentCode);
        assert.strictEqual(deposit.status, 'completed');

        // Check user balance is credited
        const user = userService.get(testUser.id);
        assert.strictEqual(user.balance, depositAmount);
    });

    test('PaymentService - encrypt and decrypt static ID', () => {
        const paymentService = require('../src/services/paymentService');
        const telegramId = '99999903';
        const zaloId = '530718471553674179';

        const encryptedTelegram = paymentService.encryptUserId(telegramId);
        const decryptedTelegram = paymentService.decryptUserId(encryptedTelegram);
        assert.strictEqual(decryptedTelegram, telegramId);

        const encryptedZalo = paymentService.encryptUserId(zaloId);
        const decryptedZalo = paymentService.decryptUserId(encryptedZalo);
        assert.strictEqual(decryptedZalo, zaloId);
    });

    test('POST /webhook/sepay - completes static ID deposit', async () => {
        const paymentService = require('../src/services/paymentService');
        const depositAmount = 250000;
        
        // 1. Test static Telegram ID deposit
        const cleanPrefix = (config.PAYMENT_PREFIX || 'CB').replace(/[-\s]/g, '');
        const staticTelegramCode = `${cleanPrefix}${paymentService.encryptUserId(testUser.id)}`;
        
        const resTelegram = await fetch(`${baseUrl}/webhook/sepay`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Apikey test-secret-key'
            },
            body: JSON.stringify({
                content: `Nap vi static ${staticTelegramCode}`,
                transferAmount: depositAmount
            })
        });

        assert.strictEqual(resTelegram.status, 200);
        const dataTelegram = await resTelegram.json();
        assert.strictEqual(dataTelegram.success, true);

        // Check user balance is credited (should be depositAmount since beforeEach reset it to 0)
        let user = userService.get(testUser.id);
        assert.strictEqual(user.balance, depositAmount);

        // 2. Test static Zalo ID deposit (we will register a temporary Zalo user)
        const testZaloUser = {
            id: 530718471553674179,
            username: 'test_zalo_static',
            first_name: 'Lan',
            last_name: 'Huong'
        };
        userService.findOrCreate(testZaloUser);
        
        const staticZaloCode = `${cleanPrefix}${paymentService.encryptUserId(testZaloUser.id)}`;

        const resZalo = await fetch(`${baseUrl}/webhook/sepay`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Apikey test-secret-key'
            },
            body: JSON.stringify({
                content: `Nạp ví Zalo: ${staticZaloCode}`,
                transferAmount: depositAmount
            })
        });

        assert.strictEqual(resZalo.status, 200);
        const dataZalo = await resZalo.json();
        assert.strictEqual(dataZalo.success, true);

        // Check Zalo user balance is credited
        const zaloUser = userService.get(testZaloUser.id);
        assert.strictEqual(zaloUser.balance, depositAmount);

        // Clean up test Zalo user
        db.prepare('DELETE FROM deposits WHERE user_id = ?').run(testZaloUser.id);
        db.prepare('DELETE FROM users WHERE telegram_id = ?').run(testZaloUser.id);
    });

    test('SSO Login - single use and expiration validation', async () => {
        const token = 'sso-test-token-xyz';
        activeTempTokens[token] = {
            username: 'admin',
            role: 'admin',
            expiresAt: Date.now() + 5000 // valid for 5 seconds
        };

        // Try to access login using token
        // Use redirect: 'manual' to intercept the redirection
        let res = await fetch(`${baseUrl}/admin/login?token=${token}`, {
            redirect: 'manual'
        });

        assert.strictEqual(res.status, 302);
        assert.ok(res.headers.get('location').includes('/admin/dashboard'));
        assert.ok(res.headers.get('set-cookie').includes('session_id='));

        // Try to login again with the same token - should fail because it was deleted
        res = await fetch(`${baseUrl}/admin/login?token=${token}`);
        assert.strictEqual(res.status, 400);
        assert.ok((await res.text()).includes('hết hạn hoặc không hợp lệ'));
    });
});
