const messages = require('../utils/messages');

module.exports = (bot) => {
    const showSupport = (ctx) => {
        ctx.replyWithHTML(messages.supportInfo);
    };

    bot.command('support', showSupport);
    bot.hears('🆘 Hỗ trợ', showSupport);
};
