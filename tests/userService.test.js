const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/database');
const userService = require('../src/services/userService');

test.describe('UserService Tests', () => {
    const testUser = {
        id: 99999901,
        username: 'test_user_wallet',
        first_name: 'Nguyen Van',
        last_name: 'Test'
    };

    // Wait for database initialization
    test.before(async () => {
        await db.initPromise;
    });

    // Clean up before and after tests
    test.beforeEach(async () => {
        await db.query('DELETE FROM users WHERE telegram_id = $1', [String(testUser.id)]);
    });

    test.after(async () => {
        await db.query('DELETE FROM users WHERE telegram_id = $1', [String(testUser.id)]);
        await db.end();
    });

    test('findOrCreate - should create new user if not exists', async () => {
        const user = await userService.findOrCreate(testUser);
        assert.ok(user);
        assert.strictEqual(user.telegram_id, String(testUser.id));
        assert.strictEqual(user.username, testUser.username);
        assert.strictEqual(user.full_name, 'Nguyen Van Test');
        assert.strictEqual(user.balance, 0);

        // Find existing user
        const existingUser = await userService.findOrCreate(testUser);
        assert.strictEqual(existingUser.telegram_id, String(testUser.id));
        assert.strictEqual(existingUser.balance, 0);
    });

    test('get - should retrieve user by Telegram ID', async () => {
        // Create first
        await userService.findOrCreate(testUser);
        const retrieved = await userService.get(testUser.id);
        assert.ok(retrieved);
        assert.strictEqual(retrieved.telegram_id, String(testUser.id));

        const nonExistent = await userService.get(99999999);
        assert.strictEqual(nonExistent, null);
    });

    test('addBalance - should increase balance', async () => {
        await userService.findOrCreate(testUser);
        
        await userService.addBalance(testUser.id, 50000);
        let user = await userService.get(testUser.id);
        assert.strictEqual(user.balance, 50000);

        await userService.addBalance(testUser.id, 25000);
        user = await userService.get(testUser.id);
        assert.strictEqual(user.balance, 75000);
    });

    test('deductBalance - should deduct balance if sufficient', async () => {
        await userService.findOrCreate(testUser);
        
        // Try to deduct without balance
        let success = await userService.deductBalance(testUser.id, 10000);
        assert.strictEqual(success, false);

        // Add and deduct
        await userService.addBalance(testUser.id, 50000);
        success = await userService.deductBalance(testUser.id, 20000);
        assert.strictEqual(success, true);

        let user = await userService.get(testUser.id);
        assert.strictEqual(user.balance, 30000);

        // Try to deduct more than balance
        success = await userService.deductBalance(testUser.id, 40000);
        assert.strictEqual(success, false);
        user = await userService.get(testUser.id);
        assert.strictEqual(user.balance, 30000); // balance remains unchanged
    });
});
