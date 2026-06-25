const userService = require('../services/userService');
const messages = require('../utils/messages');
const { mainMenuKeyboard } = require('../utils/keyboard');
const fs = require('fs');
const path = require('path');
const debugLogPath = path.join(__dirname, '..', 'debug.log');

module.exports = (bot) => {
    bot.start(async (ctx) => {
        const log = (msg) => fs.appendFileSync(debugLogPath, `[Start Command] ${msg}\n`);
        log(`Executing start handler for user ${ctx.from.id}...`);
        try {
            const user = userService.findOrCreate(ctx.from);
            log(`User found/created: ${user.full_name}`);
            await ctx.replyWithHTML(messages.welcome(user.full_name), mainMenuKeyboard());
            log('Reply sent successfully.');
        } catch (e) {
            log(`Error in handler: ${e.message}`);
            console.error('[Start Command] Error in handler:', e.message);
            throw e;
        }
    });
};

