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

    // Clean up before and after tests
    test.beforeEach(() => {
        db.prepare('DELETE FROM users WHERE telegram_id = ?').run(String(testUser.id));
    });

    test.after(() => {
        db.prepare('DELETE FROM users WHERE telegram_id = ?').run(String(testUser.id));
    });

    test('findOrCreate - should create new user if not exists', () => {
        const user = userService.findOrCreate(testUser);
        assert.ok(user);
        assert.strictEqual(user.telegram_id, String(testUser.id));
        assert.strictEqual(user.username, testUser.username);
        assert.strictEqual(user.full_name, 'Nguyen Van Test');
        assert.strictEqual(user.balance, 0);

        // Find existing user
        const existingUser = userService.findOrCreate(testUser);
        assert.strictEqual(existingUser.telegram_id, String(testUser.id));
        assert.strictEqual(existingUser.balance, 0);
    });

    test('get - should retrieve user by Telegram ID', () => {
        // Create first
        userService.findOrCreate(testUser);
        const retrieved = userService.get(testUser.id);
        assert.ok(retrieved);
        assert.strictEqual(retrieved.telegram_id, String(testUser.id));

        const nonExistent = userService.get(99999999);
        assert.strictEqual(nonExistent, undefined);
    });

    test('addBalance - should increase balance', () => {
        userService.findOrCreate(testUser);
        
        userService.addBalance(testUser.id, 50000);
        let user = userService.get(testUser.id);
        assert.strictEqual(user.balance, 50000);

        userService.addBalance(testUser.id, 25000);
        user = userService.get(testUser.id);
        assert.strictEqual(user.balance, 75000);
    });

    test('deductBalance - should deduct balance if sufficient', () => {
        userService.findOrCreate(testUser);
        
        // Try to deduct without balance
        let success = userService.deductBalance(testUser.id, 10000);
        assert.strictEqual(success, false);

        // Add and deduct
        userService.addBalance(testUser.id, 50000);
        success = userService.deductBalance(testUser.id, 20000);
        assert.strictEqual(success, true);

        let user = userService.get(testUser.id);
        assert.strictEqual(user.balance, 30000);

        // Try to deduct more than balance
        success = userService.deductBalance(testUser.id, 40000);
        assert.strictEqual(success, false);
        user = userService.get(testUser.id);
        assert.strictEqual(user.balance, 30000); // balance remains unchanged
    });
});
