const { Markup } = require('telegraf');

/**
 * Format price in VND
 */
function formatPrice(amount) {
    return new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
}

/**
 * Build product (medical package) list keyboard
 */
function productListKeyboard(products) {
    const buttons = products.map((p) => {
        let label = `${p.emoji} ${p.name} - ${formatPrice(p.price)}`;
        if (p.deposit_amount > 0) {
            label += ` (Cọc: ${formatPrice(p.deposit_amount)})`;
        }
        if (p.promotion) {
            label += ` ${p.promotion}`;
        }
        return [Markup.button.callback(label, `product_${p.id}`)];
    });

    buttons.push([Markup.button.callback('🔄 Làm mới', 'refresh_products')]);

    return Markup.inlineKeyboard(buttons);
}

/**
 * Build date selection keyboard (7 days ahead)
 */
function dateSelectionKeyboard(productId) {
    const buttons = [];
    const weekdays = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    
    for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() + i);
        
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        
        const dayName = i === 0 ? 'Hôm nay' : weekdays[date.getDay()];
        const label = `${dayName} (${day}/${month})`;
        
        buttons.push([Markup.button.callback(label, `date_${productId}_${dateStr}`)]);
    }
    
    buttons.push([Markup.button.callback('↩️ Quay lại', 'refresh_products')]);
    
    return Markup.inlineKeyboard(buttons);
}

/**
 * Build time slots keyboard for a specific date
 */
function timeSlotKeyboard(productId, dateStr, clinicHours, occupiedSlots) {
    const buttons = [];
    let row = [];
    
    clinicHours.forEach((hour) => {
        const count = occupiedSlots[hour.time_label] || 0;
        const remaining = Math.max(0, hour.max_capacity - count);
        
        let label = '';
        let callbackData = '';
        
        if (remaining === 0 || !hour.is_active) {
            label = `❌ ${hour.time_label} (Hết chỗ)`;
            callbackData = `slot_full`;
        } else {
            label = `🟢 ${hour.time_label} (${remaining} chỗ)`;
            callbackData = `slot_${productId}_${dateStr}_${hour.id}`;
        }
        
        row.push(Markup.button.callback(label, callbackData));
        
        if (row.length === 1) { // 1 column per row for readability
            buttons.push(row);
            row = [];
        }
    });
    
    if (row.length > 0) buttons.push(row);
    
    buttons.push([
        Markup.button.callback('↩️ Quay lại chọn ngày', `product_${productId}`)
    ]);
    
    return Markup.inlineKeyboard(buttons);
}

/**
 * Build booking target selection (Self or Family member)
 */
function bookingTargetKeyboard(productId, dateStr, hourId) {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('🙋‍♂️ Cho bản thân', `target_self_${productId}_${dateStr}_${hourId}`),
            Markup.button.callback('👥 Cho người thân', `target_other_${productId}_${dateStr}_${hourId}`)
        ],
        [Markup.button.callback('↩️ Quay lại chọn giờ', `date_${productId}_${dateStr}`)]
    ]);
}

/**
 * Build reply keyboard asking for contact share
 */
function phoneVerificationKeyboard() {
    return Markup.keyboard([
        [Markup.button.contactRequest('📱 Chia sẻ số điện thoại xác thực')]
    ]).oneTime().resize();
}

/**
 * Build booking confirmation keyboard
 */
function bookingConfirmKeyboard(tempBookingId, hasEnoughBalance = false) {
    const buttons = [];
    if (hasEnoughBalance) {
        buttons.push([
            Markup.button.callback('💵 Thanh toán bằng ví tích điểm', `bk_pay_wallet_${tempBookingId}`)
        ]);
    }
    buttons.push([
        Markup.button.callback('✅ Xác nhận & Đặt cọc', `bk_confirm_${tempBookingId}`),
        Markup.button.callback('❌ Hủy bỏ', 'cancel_booking')
    ]);
    return Markup.inlineKeyboard(buttons);
}

/**
 * Build post-booking keyboard
 */
function postBookingKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('📋 Về danh sách gói khám', 'refresh_products')]
    ]);
}

/**
 * Main menu keyboard (reply keyboard)
 */
function mainMenuKeyboard() {
    return Markup.keyboard([
        ['📅 Đặt lịch khám', '👤 Tài khoản'],
        ['💰 Nạp tiền', '🔍 Lịch khám của bạn'],
        ['🆘 Hỗ trợ']
    ]).resize();
}

module.exports = {
    formatPrice,
    productListKeyboard,
    dateSelectionKeyboard,
    timeSlotKeyboard,
    bookingTargetKeyboard,
    phoneVerificationKeyboard,
    bookingConfirmKeyboard,
    postBookingKeyboard,
    mainMenuKeyboard,
};
