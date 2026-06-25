const config = require('../config');
const { Markup } = require('telegraf');
const crypto = require('crypto');
const userService = require('../services/userService');
const { formatPrice } = require('../utils/keyboard');

function isAdmin(ctx) {
    return ctx.from.id === config.ADMIN_ID;
}

function adminOnly(ctx, next) {
    if (!isAdmin(ctx)) {
        return ctx.replyWithHTML('⛔ Bạn không có quyền sử dụng lệnh này.');
    }
    return next();
}

module.exports = (bot) => {
    // Admin command to show Dashboard details
    bot.command('admin', adminOnly, (ctx) => {
        const isLocal = !config.PUBLIC_URL || config.PUBLIC_URL.includes('localhost') || config.PUBLIC_URL.includes('127.0.0.1');
        
        ctx.replyWithHTML(
            `🔧 <b>ADMIN PANEL — ${config.SHOP_NAME}</b>\n\n` +
            `Để quản lý lịch khám, dịch vụ, và tài khoản nhân viên, quý khách vui lòng truy cập Web Dashboard.\n\n` +
            `🖥️ <b>WEB DASHBOARD:</b>\n` +
            `/dashboard — Nhận link đăng nhập Web Dashboard\n` +
            `/seturl [URL] — Cấu hình URL công khai của phòng khám\n`
        );
    });

    // /dashboard - Access login URL with one-time SSO token
    bot.command('dashboard', adminOnly, (ctx) => {
        const token = crypto.randomBytes(16).toString('hex');
        
        // Register temp token for one-time login
        const { activeTempTokens } = require('../services/webhookService');
        if (activeTempTokens) {
            activeTempTokens[token] = {
                username: 'admin',
                role: 'admin',
                expiresAt: Date.now() + 60 * 1000 // valid for 1 minute
            };
        }

        ctx.replyWithHTML(
            `🖥️ <b>WEB DASHBOARD — ${config.SHOP_NAME}</b>\n\n` +
            `Vui lòng click vào liên kết bên dưới để đăng nhập nhanh một lần vào trang quản trị phòng khám:\n` +
            `🌐 URL: <code>${config.PUBLIC_URL}/admin/login?token=${token}</code>\n\n` +
            `⚠️ <i>Lưu ý: Liên kết này chỉ có hiệu lực trong vòng 1 phút và sẽ tự động hết hạn sau lần truy cập đầu tiên để bảo mật.</i>`
        );
    });

    // /seturl [URL] - Update public URL
    bot.command('seturl', adminOnly, (ctx) => {
        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
            return ctx.replyWithHTML(
                `ℹ️ <b>Cấu hình URL công khai hiện tại:</b>\n` +
                `<code>${config.PUBLIC_URL}</code>\n\n` +
                `Cách dùng để thay đổi:\n` +
                `<code>/seturl https://phongkham-cua-ban.vn</code>`
            );
        }

        const newUrl = args[1].trim();
        if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
            return ctx.reply('❌ URL phải bắt đầu bằng http:// hoặc https://');
        }

        config.PUBLIC_URL = newUrl;
        ctx.replyWithHTML(`✅ Đã cập nhật URL công khai thành: <code>${config.PUBLIC_URL}</code>`);
    });

    // /addbalance [telegram_id] [amount] - Add balance to user
    bot.command('addbalance', adminOnly, async (ctx) => {
        const args = ctx.message.text.split(' ');
        if (args.length < 3) {
            return ctx.replyWithHTML(
                `ℹ️ <b>Cộng tiền/hoàn tiền vào ví:</b>\n` +
                `Cách dùng:\n` +
                `<code>/addbalance [Telegram_ID] [Số_tiền]</code>\n` +
                `Ví dụ: <code>/addbalance 1076785545 50000</code>`
            );
        }

        const targetIdStr = args[1];
        const amount = parseInt(args[2]);

        if (!targetIdStr || !/^\d+$/.test(targetIdStr) || isNaN(amount) || amount <= 0) {
            return ctx.reply('❌ Telegram/Zalo ID hoặc Số tiền không hợp lệ.');
        }

        const user = userService.get(targetIdStr);
        if (!user) {
            return ctx.reply('❌ Không tìm thấy thông tin bệnh nhân này trong database.');
        }

        userService.addBalance(targetIdStr, amount);
        const updatedUser = userService.get(targetIdStr);

        ctx.replyWithHTML(`✅ Đã cộng <b>${formatPrice(amount)}</b> vào tài khoản của <b>${updatedUser.full_name || targetIdStr}</b>. Số dư mới: <b>${formatPrice(updatedUser.balance)}</b>`);

        // Notify customer
        try {
            const isZalo = targetIdStr.length >= 12;
            if (isZalo) {
                const zaloBotService = require('../services/zaloBotService');
                await zaloBotService.sendMessage(
                    targetIdStr,
                    `💰 <b>BIẾN ĐỘNG SỐ DƯ VÍ</b>\n\n` +
                    `Tài khoản ví tích điểm của bạn đã được cộng: <b>+${formatPrice(amount)}</b>.\n` +
                    `💵 Số dư hiện tại: <b>${formatPrice(updatedUser.balance)}</b>.`,
                    'html'
                );
            } else {
                await bot.telegram.sendMessage(
                    targetIdStr,
                    `💰 <b>BIẾN ĐỘNG SỐ DƯ VÍ</b>\n\n` +
                    `Tài khoản ví tích điểm của bạn đã được cộng: <b>+${formatPrice(amount)}</b>.\n` +
                    `💵 Số dư hiện tại: <b>${formatPrice(updatedUser.balance)}</b>.`,
                    { parse_mode: 'HTML' }
                );
            }
        } catch (err) {
            console.error('Failed to notify customer of manual balance credit:', err.message);
        }
    });

    // /deductbalance [telegram_id] [amount] - Deduct balance from user
    bot.command('deductbalance', adminOnly, async (ctx) => {
        const args = ctx.message.text.split(' ');
        if (args.length < 3) {
            return ctx.replyWithHTML(
                `ℹ️ <b>Trừ tiền từ ví:</b>\n` +
                `Cách dùng:\n` +
                `<code>/deductbalance [Telegram_ID] [Số_tiền]</code>\n` +
                `Ví dụ: <code>/deductbalance 1076785545 50000</code>`
            );
        }

        const targetIdStr = args[1];
        const amount = parseInt(args[2]);

        if (!targetIdStr || !/^\d+$/.test(targetIdStr) || isNaN(amount) || amount <= 0) {
            return ctx.reply('❌ Telegram/Zalo ID hoặc Số tiền không hợp lệ.');
        }

        const user = userService.get(targetIdStr);
        if (!user) {
            return ctx.reply('❌ Không tìm thấy thông tin bệnh nhân này trong database.');
        }

        if (user.balance < amount) {
            return ctx.reply(`❌ Số dư ví hiện tại (${formatPrice(user.balance)}) ít hơn số tiền muốn trừ.`);
        }

        userService.deductBalance(targetIdStr, amount);
        const updatedUser = userService.get(targetIdStr);

        ctx.replyWithHTML(`✅ Đã trừ <b>${formatPrice(amount)}</b> từ tài khoản của <b>${updatedUser.full_name || targetIdStr}</b>. Số dư mới: <b>${formatPrice(updatedUser.balance)}</b>`);

        // Notify customer
        try {
            const isZalo = targetIdStr.length >= 12;
            if (isZalo) {
                const zaloBotService = require('../services/zaloBotService');
                await zaloBotService.sendMessage(
                    targetIdStr,
                    `💰 <b>BIẾN ĐỘNG SỐ DƯ VÍ</b>\n\n` +
                    `Tài khoản ví tích điểm của bạn đã bị trừ: <b>-${formatPrice(amount)}</b>.\n` +
                    `💵 Số dư hiện tại: <b>${formatPrice(updatedUser.balance)}</b>.`,
                    'html'
                );
            } else {
                await bot.telegram.sendMessage(
                    targetIdStr,
                    `💰 <b>BIẾN ĐỘNG SỐ DƯ VÍ</b>\n\n` +
                    `Tài khoản ví tích điểm của bạn đã bị trừ: <b>-${formatPrice(amount)}</b>.\n` +
                    `💵 Số dư hiện tại: <b>${formatPrice(updatedUser.balance)}</b>.`,
                    { parse_mode: 'HTML' }
                );
            }
        } catch (err) {
            console.error('Failed to notify customer of manual balance debit:', err.message);
        }
    });
};
