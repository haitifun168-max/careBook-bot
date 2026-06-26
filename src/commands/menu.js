const userService = require('../services/userService');
const messages = require('../utils/messages');
const db = require('../database');

module.exports = (bot) => {
    const showMenu = async (ctx) => {
        const user = await userService.findOrCreate(ctx.from);
        const apptCountRes = await db.query('SELECT COUNT(*) as c FROM appointments WHERE user_id = $1', [user.telegram_id]);
        const apptCount = parseInt(apptCountRes.rows[0]?.c || 0);
        await ctx.replyWithHTML(messages.accountInfo(user, apptCount));
    };

    bot.command('menu', showMenu);
    bot.hears('👤 Tài khoản', showMenu);
};
