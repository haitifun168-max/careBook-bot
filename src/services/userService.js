const db = require('../database');

const userService = {
    /**
     * Find or create user
     */
    async findOrCreate(telegramUser) {
        const userIdStr = String(telegramUser.id);
        const existingRes = await db.query('SELECT * FROM users WHERE telegram_id = $1', [userIdStr]);
        if (existingRes.rows.length > 0) return existingRes.rows[0];

        const fullName = [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ');
        await db.query(
            'INSERT INTO users (telegram_id, username, full_name) VALUES ($1, $2, $3) ON CONFLICT (telegram_id) DO NOTHING',
            [userIdStr, telegramUser.username || null, fullName]
        );

        const finalRes = await db.query('SELECT * FROM users WHERE telegram_id = $1', [userIdStr]);
        return finalRes.rows[0];
    },

    /**
     * Get user by telegram ID
     */
    async get(telegramId) {
        const res = await db.query('SELECT * FROM users WHERE telegram_id = $1', [String(telegramId)]);
        return res.rows[0] || null;
    },

    /**
     * Update balance
     */
    async addBalance(telegramId, amount) {
        await db.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [amount, String(telegramId)]);
    },

    /**
     * Deduct balance
     */
    async deductBalance(telegramId, amount) {
        const user = await this.get(telegramId);
        if (!user || user.balance < amount) return false;
        await db.query('UPDATE users SET balance = balance - $1 WHERE telegram_id = $2', [amount, String(telegramId)]);
        return true;
    },
};

module.exports = userService;
