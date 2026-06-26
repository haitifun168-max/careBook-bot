const userService = require('../services/userService');
const messages = require('../utils/messages');
const db = require('../database');

module.exports = (bot) => {
    const showMenu = async (ctx) => {
        const user = await userService.findOrCreate(ctx.from);
        const apptCountRes = await db.query('SELECT COUNT(*) as c FROM appointments WHERE user_id = $1', [user.telegram_id]);
        const apptCount = parseInt(apptCountRes.rows[0]?.c || 0);
        
        await ctx.replyWithHTML(messages.accountInfo(user, apptCount), {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📜 Lịch sử giao dịch', callback_data: 'view_transactions' },
                        { text: '🎁 Ưu đãi của tôi', callback_data: 'view_promotions' }
                    ]
                ]
            }
        });
    };

    bot.command('menu', showMenu);
    bot.hears('👤 Tài khoản', showMenu);

    // Callback query for viewing transaction history
    bot.action('view_transactions', async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => {});
            const telegramId = String(ctx.from.id);
            
            const transRes = await db.query(`
                SELECT 
                    'deposit' as type,
                    amount as val,
                    payment_code,
                    status,
                    created_at
                FROM deposits
                WHERE user_id = $1
                UNION ALL
                SELECT 
                    'appointment' as type,
                    deposit_amount as val,
                    payment_code,
                    status,
                    created_at
                FROM appointments
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT 10
            `, [telegramId]);

            let text = '📜 <b>LỊCH SỬ GIAO DỊCH GẦN ĐÂY</b>\n\n';
            if (transRes.rows.length === 0) {
                text += '<i>Bạn chưa có giao dịch nào trên hệ thống.</i>';
            } else {
                transRes.rows.forEach(t => {
                    const dateStr = new Date(t.created_at).toLocaleDateString('vi-VN');
                    const formattedAmount = new Intl.NumberFormat('vi-VN').format(t.val) + 'đ';
                    const typeText = t.type === 'deposit' ? '➕ Nạp ví' : '➖ Trực tiếp (Cọc)';
                    const statusText = t.status === 'completed' || t.status === 'confirmed' ? '✅ Thành công' : (t.status === 'pending' ? '⏳ Chờ xử lý' : '❌ Đã hủy');
                    text += `• <b>${dateStr}</b> | ${typeText}: <b>${formattedAmount}</b>\n` +
                            `  ├ Mã: <code>${t.payment_code}</code>\n` +
                            `  └ Trạng thái: ${statusText}\n\n`;
                });
            }
            await ctx.replyWithHTML(text);
        } catch (err) {
            console.error('Error handling view_transactions:', err);
            await ctx.reply('❌ Không thể tải lịch sử giao dịch lúc này.').catch(() => {});
        }
    });

    // Callback query for viewing active campaigns and usages
    bot.action('view_promotions', async (ctx) => {
        try {
            await ctx.answerCbQuery().catch(() => {});
            const telegramId = String(ctx.from.id);

            const activeCampaignsRes = await db.query(`
                SELECT name, type, value 
                FROM marketing_campaigns 
                WHERE is_active = 1 AND budget_spent + value <= budget_limit
            `);

            const myUsagesRes = await db.query(`
                SELECT mc.name as campaign_name, cu.amount_used, cu.created_at
                FROM campaign_usages cu
                JOIN marketing_campaigns mc ON cu.campaign_id = mc.id
                WHERE cu.user_id = $1
                ORDER BY cu.created_at DESC
            `, [telegramId]);

            let text = '🎁 <b>ƯU ĐÃI CỦA BẠN</b>\n\n';

            text += '📢 <b>Chiến dịch ưu đãi hiện tại:</b>\n';
            if (activeCampaignsRes.rows.length === 0) {
                text += '• <i>Hiện tại chưa có chiến dịch ưu đãi mới.</i>\n\n';
            } else {
                activeCampaignsRes.rows.forEach(c => {
                    const valText = new Intl.NumberFormat('vi-VN').format(c.value) + 'đ';
                    const desc = c.type === 'attract' ? 
                        `Tặng <b>+${valText}</b> vào ví tích điểm cho khách mới đặt lịch khám lần đầu.` :
                        `Hoàn tiền <b>+${valText}</b> vào ví tích điểm cho khách cũ khi tái khám cọc thành công.`;
                    text += `• <b>${c.name}</b>\n  └ ${desc}\n\n`;
                });
            }

            text += '💰 <b>Lịch sử nhận ưu đãi:</b>\n';
            if (myUsagesRes.rows.length === 0) {
                text += '• <i>Bạn chưa nhận ưu đãi nào. Đặt lịch khám ngay để tích điểm ví!</i>';
            } else {
                myUsagesRes.rows.forEach(u => {
                    const dateStr = new Date(u.created_at).toLocaleDateString('vi-VN');
                    const amtText = new Intl.NumberFormat('vi-VN').format(u.amount_used) + 'đ';
                    text += `• <b>${dateStr}</b>: Hoàn <b>+${amtText}</b> từ <i>${u.campaign_name}</i>\n`;
                });
            }
            await ctx.replyWithHTML(text);
        } catch (err) {
            console.error('Error handling view_promotions:', err);
            await ctx.reply('❌ Không thể tải thông tin ưu đãi lúc này.').catch(() => {});
        }
    });
};
