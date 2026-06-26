const productService = require('../services/productService');
const messages = require('../utils/messages');
const { productListKeyboard } = require('../utils/keyboard');

module.exports = (bot) => {
    bot.command('product', async (ctx) => {
        await sendProductList(ctx);
    });

    bot.hears('📦 Sản phẩm', async (ctx) => {
        await sendProductList(ctx);
    });

    bot.hears('📅 Đặt lịch khám', async (ctx) => {
        await sendProductList(ctx);
    });

    // Refresh products callback
    bot.action('refresh_products', async (ctx) => {
        await ctx.answerCbQuery('🔄 Đang làm mới...').catch(() => {});
        await sendProductList(ctx, true);
    });
};

async function sendProductList(ctx, edit = false) {
    const products = await productService.getAll();

    if (products.length === 0) {
        const msg = '❌ Hiện tại không có sản phẩm nào.';
        return edit ? ctx.editMessageText(msg).catch(() => {}) : ctx.reply(msg).catch(() => {});
    }

    const keyboard = productListKeyboard(products);
    const text = messages.productHeader;

    if (edit) {
        await ctx.editMessageText(text, keyboard).catch(() => {});
    } else {
        await ctx.reply(text, keyboard).catch(() => {});
    }
}
