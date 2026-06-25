const db = require('../database');

const userService = {
    /**
     * Find or create user
     */
    findOrCreate(telegramUser) {
        const userIdStr = String(telegramUser.id);
        const existing = db.prepare('SELECT *, CAST(telegram_id AS TEXT) as telegram_id FROM users WHERE telegram_id = ?').get(userIdStr);
        if (existing) return existing;

        const fullName = [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ');
        db.prepare(
            'INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)'
        ).run(userIdStr, telegramUser.username || null, fullName);

        return db.prepare('SELECT *, CAST(telegram_id AS TEXT) as telegram_id FROM users WHERE telegram_id = ?').get(userIdStr);
    },

    /**
     * Get user by telegram ID
     */
    get(telegramId) {
        return db.prepare('SELECT *, CAST(telegram_id AS TEXT) as telegram_id FROM users WHERE telegram_id = ?').get(String(telegramId));
    },

    /**
     * Update balance
     */
    addBalance(telegramId, amount) {
        db.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id = ?').run(amount, String(telegramId));
    },

    /**
     * Deduct balance
     */
    deductBalance(telegramId, amount) {
        const user = this.get(telegramId);
        if (!user || user.balance < amount) return false;
        db.prepare('UPDATE users SET balance = balance - ? WHERE telegram_id = ?').run(amount, String(telegramId));
        return true;
    },
};

module.exports = userService;
