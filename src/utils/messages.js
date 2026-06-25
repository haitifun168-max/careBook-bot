const config = require('../config');
const { formatPrice } = require('./keyboard');

const CLINIC = config.SHOP_NAME;

const messages = {
    welcome: (name) =>
        `👋 Chào mừng <b>${name}</b> đến với Hệ thống Đặt lịch khám <b>${CLINIC}</b>!\n\n` +
        `🦷 Chúng tôi cung cấp các dịch vụ nha khoa chất lượng cao, thẩm mỹ và điều trị không đau.\n\n` +
        `📋 <b>Danh sách lệnh hỗ trợ:</b>\n` +
        `/start — 📅 Bắt đầu đặt lịch khám mới\n` +
        `/support — 🆘 Liên hệ hỗ trợ y tế\n` +
        `/myid — 🆔 Lấy ID Telegram của bạn`,

    accountInfo: (user, appointmentsCount = 0) =>
        `👤 <b>Thông tin bệnh nhân</b>\n\n` +
        `🆔 Telegram ID: <code>${user.telegram_id}</code>\n` +
        `👤 Tên: ${user.full_name || 'Chưa cập nhật'}\n` +
        `💵 Số dư ví: <b>${formatPrice(user.balance || 0)}</b>\n` +
        `📅 Số lịch hẹn đã đặt: <b>${appointmentsCount} lịch hẹn</b>\n` +
        `⏱️ Ngày đăng ký: ${user.created_at}`,

    productHeader:
        '👇 Vui lòng chọn gói khám/dịch vụ bạn quan tâm bên dưới:',

    contactOnly: (product) =>
        `🩺 <b>Gói dịch vụ: ${product.name}</b>\n\n` +
        `💰 Chi phí ước tính: ${formatPrice(product.price)}\n` +
        (product.promotion ? `🎁 Ưu đãi: ${product.promotion}\n` : '') +
        `📝 Chi tiết: ${product.description || 'Chưa có mô tả chi tiết.'}\n\n` +
        `💬 Dịch vụ này yêu cầu bác sĩ tư vấn chi tiết trước khi đặt lịch.\n` +
        `Vui lòng liên hệ Hotline bên dưới để được tư vấn miễn phí.`,

    bookingDetails: (packageName, patientName, patientPhone, dateStr, timeLabel, depositAmount) =>
        `📝 <b>XÁC NHẬN THÔNG TIN ĐẶT LỊCH</b>\n\n` +
        `🩺 Dịch vụ: <b>${packageName}</b>\n` +
        `👤 Bệnh nhân: <b>${patientName}</b>\n` +
        `📱 Số điện thoại: <code>${patientPhone}</code>\n` +
        `📅 Ngày khám: <b>${dateStr}</b>\n` +
        `⏱️ Khung giờ: <b>${timeLabel}</b>\n` +
        `💵 Tiền cọc giữ chỗ: <b>${formatPrice(depositAmount)}</b>\n\n` +
        `⚠️ <i>Lưu ý: Tiền cọc sẽ được trừ trực tiếp vào hóa đơn khám của bạn tại phòng khám. Lịch đặt giữ chỗ tạm thời có hiệu lực trong 15 phút.</i>`,

    paymentInstructions: (depositAmount, paymentCode) =>
        `⏳ <b>Đang chờ thanh toán cọc giữ chỗ ${formatPrice(depositAmount)}...</b>\n\n` +
        `Vui lòng quét mã QR chuyển khoản phía trên hoặc thực hiện chuyển khoản với thông tin:\n\n` +
        `🏦 Ngân hàng: <b>${config.BANK.NAME}</b>\n` +
        `├ Số tài khoản: <code>${config.BANK.ACCOUNT}</code>\n` +
        `├ Chủ tài khoản: <b>${config.BANK.ACCOUNT_NAME}</b>\n` +
        `├ Số tiền: <b>${formatPrice(depositAmount)}</b>\n` +
        `└ Nội dung chuyển khoản: <code>${paymentCode}</code>\n\n` +
        `⏱️ <b>Hạn chót thanh toán: 15 phút</b>.\n` +
        `🚫 <b>KHÔNG</b> thay đổi nội dung chuyển khoản để hệ thống tự động xác nhận lịch khám cho bạn ngay lập tức!`,

    bookingSuccess: (appointment, packageName) =>
        `✅ <b>ĐẶT LỊCH KHÁM THÀNH CÔNG!</b>\n\n` +
        `Mã lịch hẹn: <b>#${appointment.id}</b>\n` +
        `🩺 Dịch vụ: <b>${packageName}</b>\n` +
        `👤 Bệnh nhân: <b>${appointment.patient_name}</b>\n` +
        `📱 Số điện thoại: ${appointment.patient_phone}\n` +
        `📅 Ngày khám: <b>${appointment.booking_date}</b>\n` +
        `⏱️ Khung giờ: <b>${appointment.booking_time}</b>\n` +
        `💵 Tiền cọc đã nhận: <b>${formatPrice(appointment.deposit_amount)}</b>\n` +
        `━━━━━━━━━━━━━━━━━\n\n` +
        `📅 <i>Lịch khám đã được đồng bộ lên Google Calendar của phòng khám. Hẹn gặp lại bạn đúng giờ khám!</i>\n\n` +
        `🚫 <b>Chính sách đổi/hủy lịch:</b> Quý khách vui lòng thực hiện đổi/hủy lịch khám trước ít nhất <b>24 giờ</b>. Mọi yêu cầu hủy lịch sát giờ khám sẽ không được hoàn cọc.`,

    bookingExpired: (packageName, dateStr, timeLabel) =>
        `❌ <b>HỦY LỊCH HẸN TỰ ĐỘNG</b>\n\n` +
        `Đã quá 15 phút kể từ lúc đăng ký đặt lịch khám:\n` +
        `🩺 Dịch vụ: ${packageName}\n` +
        `📅 Thời gian: ${timeLabel} ngày ${dateStr}\n\n` +
        `Hệ thống chưa nhận được thanh toán chuyển khoản đặt cọc giữ chỗ của bạn. Lịch hẹn này đã bị hủy tự động và giải phóng khung giờ trống cho khách hàng khác.\n` +
        `Vui lòng thực hiện đặt lịch lại nếu bạn vẫn có nhu cầu khám!`,

    noSlotsAvailable:
        '❌ Rất tiếc, khung giờ này hoặc ngày khám này hiện tại đã hết chỗ nhận bệnh nhân. Vui lòng chọn ngày khác hoặc giờ khác.',

    supportInfo:
        `🆘 <b>HỖ TRỢ Y TẾ & CHĂM SÓC KHÁCH HÀNG</b>\n\n` +
        `Nếu bạn gặp khó khăn trong quá trình đặt lịch, cần đổi giờ khám khẩn cấp hoặc tư vấn bệnh lý:\n` +
        `👉 Liên hệ ngay: ${config.SUPPORT_CONTACT}\n\n` +
        `⏰ Phòng khám mở cửa từ 8:00 - 17:30 tất cả các ngày trong tuần.`,

    myId: (id) =>
        `🆔 <b>Telegram ID của bạn:</b>\n<code>${id}</code>`,

    adminOnly: '⛔ Bạn không có quyền sử dụng lệnh này.',

    bookingCancelled: '❌ Phiên đặt lịch hẹn đã bị hủy bỏ.',

    paymentPending:
        '⏳ Chưa nhận được khoản đặt cọc. Vui lòng hoàn thành chuyển khoản hoặc chờ trong giây lát để hệ thống quét giao dịch.',

    checkApptStatus: (appt) => {
        const statusMap = {
            'pending': '⏳ Chờ thanh toán cọc',
            'confirmed': '🟢 Đã xác nhận lịch',
            'completed': '✅ Đã hoàn thành khám',
            'cancelled': '❌ Đã hủy lịch'
        };
        const statusText = statusMap[appt.status] || appt.status;
        return `📅 <b>Lịch hẹn #${appt.id}</b>\n` +
               `🩺 Dịch vụ: <b>${appt.package_name}</b>\n` +
               `👤 Bệnh nhân: <b>${appt.patient_name}</b>\n` +
               `📱 Điện thoại: <code>${appt.patient_phone}</code>\n` +
               `📅 Ngày khám: <b>${appt.booking_date}</b>\n` +
               `⏱️ Khung giờ: <b>${appt.booking_time}</b>\n` +
               `💵 Tiền cọc: <b>${formatPrice(appt.deposit_amount)}</b>\n` +
               `📌 Trạng thái: <b>${statusText}</b>`;
    }
};

module.exports = messages;
