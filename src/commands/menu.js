const userService = require('../services/userService');
const messages = require('../utils/messages');
const db = require('../database');

module.exports = (bot) => {
    const showMenu = (ctx) => {
        const user = userService.findOrCreate(ctx.from);
        const apptCount = db.prepare('SELECT COUNT(*) as c FROM appointments WHERE user_id = ?').get(user.telegram_id)?.c || 0;
        ctx.replyWithHTML(messages.accountInfo(user, apptCount));
    };

    bot.command('menu', showMenu);
    bot.hears('👤 Tài khoản', showMenu);
};
