# 📖 TÀI LIỆU HƯỚNG DẪN SỬ DỤNG HỆ THỐNG CAREBOOK CLINIC BOT & WEB DASHBOARD
*(Tài liệu dành cho Khách hàng và Ban quản trị phòng khám)*

---

## 👤 PHẦN 1: HƯỚNG DẪN DÀNH CHO BỆNH NHÂN (NGƯỜI DÙNG BOT)

Bệnh nhân tương tác với hệ thống đặt lịch tự động thông qua Telegram Bot bằng các nút bấm menu hoặc câu lệnh nhanh.

### 1. Các lệnh tương tác chính
*   `/start` — 📅 Bắt đầu đặt lịch khám mới (Hiển thị lời chào và menu chính).
*   `/menu` — 👤 Xem thông tin bệnh nhân (ID, Số dư ví tích điểm, số lịch khám đã đặt).
*   `/product` — 🩺 Danh sách dịch vụ và gói khám (Nha khoa thẩm mỹ, Tiểu phẫu, Tổng quát).
*   `/nap` — 💰 Nạp tiền vào ví tích điểm để đặt lịch nhanh (Ví dụ: `/nap 50000`).
*   `/checkpay` — 🔍 Lịch khám của bạn (Xem trạng thái của 5 lịch hẹn gần đây nhất).
*   `/support` — 🆘 Hỗ trợ y tế và thông tin liên hệ khẩn cấp của phòng khám.
*   `/myid` — 🆔 Lấy ID Telegram cá nhân.

---

### 2. Luồng Đăng ký Đặt lịch khám
1.  Gõ `/start` hoặc nhấn nút **📅 Đặt lịch khám** trên Menu chính.
2.  Chọn danh mục dịch vụ → Chọn gói khám quan tâm.
3.  **Chọn thời gian**:
    *   Hệ thống hiển thị danh sách 7 ngày tiếp theo. Chọn ngày bạn muốn khám.
    *   Hệ thống hiển thị danh sách các khung giờ (ví dụ: `08:00 - 09:00`, `14:30 - 15:30`). Khung giờ nào đã đủ người đặt sẽ báo đỏ và khóa lại. Chọn khung giờ còn trống (màu xanh).
4.  **Nhập thông tin bệnh nhân**:
    *   Chọn đặt lịch **"Cho bản thân"** (Hệ thống sẽ lấy thông tin tên Telegram và yêu cầu chia sẻ số điện thoại xác thực bằng nút bấm tiện lợi).
    *   Chọn đặt lịch **"Cho người thân"** (Hệ thống yêu cầu nhập Họ tên và Số điện thoại liên hệ của người thân).
5.  **Xác nhận thông tin & Thanh toán cọc giữ chỗ**:
    *   Sau khi nhập xong thông tin, Bot gửi thẻ xác nhận thông tin chi tiết kèm số tiền cọc giữ chỗ. Khung giờ này được tạm khóa trong **15 phút** để đợi đặt cọc.
    *   **Thanh toán trực tiếp**: Quét mã **QR VietQR** do Bot gửi, chuyển khoản đúng số tiền và nội dung chuyển khoản tự động (Ví dụ: `NAP PAY-XYZ123`). Hệ thống SePay sẽ tự động khớp lệnh trong 3 - 5 giây, đổi trạng thái lịch hẹn thành **Đã xác nhận (Confirmed)**, đồng bộ sang **Google Calendar** của phòng khám và thông báo thành công cho bạn.
    *   **Thanh toán bằng ví tích điểm**: Nếu ví tích điểm của bạn có đủ tiền cọc, thẻ xác nhận sẽ xuất hiện nút **"💵 Thanh toán bằng ví tích điểm"**. Nhấn nút này, hệ thống sẽ trừ trực tiếp điểm ví và xác nhận lịch hẹn ngay lập tức mà không cần chuyển khoản ngân hàng.

---

### 3. Hướng dẫn Nạp tiền vào ví tích điểm
1.  Bệnh nhân gõ `/nap [số tiền]` (Ví dụ: `/nap 100000`) hoặc nhấn nút **💰 Nạp tiền**.
2.  Bot gửi mã **QR VietQR** chuyển khoản với nội dung định danh cụ thể.
3.  Khi giao dịch được thực hiện thành công, Webhook SePay sẽ báo về và hệ thống tự động cộng tiền vào ví tích điểm của bệnh nhân, đồng thời nhắn tin thông báo biến động số dư.

---

## 🔧 PHẦN 2: HƯỚNG DẪN DÀNH CHO ADMIN & NHÂN VIÊN PHÒNG KHÁM

Admin và nhân viên phòng khám quản trị hệ thống qua hai kênh: **Web Dashboard** và **Telegram Admin Commands**.

### A. QUẢN TRỊ QUA WEB DASHBOARD (KHUYÊN DÙNG)
Đăng nhập tại đường dẫn: `https://[DOMAIN_CỦA_BẠN]/admin/login` (Hoặc gửi lệnh `/dashboard` cho Bot để lấy nhanh liên kết đăng nhập).

#### 1. Đăng nhập bảo mật OTP qua Telegram
1.  Truy cập trang đăng nhập Dashboard. Nhập tài khoản và mật khẩu của bạn.
2.  Nhấn nút **Gửi mã OTP qua Telegram**.
3.  Hệ thống sẽ gửi mã OTP gồm 6 chữ số tới Telegram cá nhân của Admin. Nhập mã này vào trang đăng nhập để vào Dashboard.

#### 2. Các phân hệ trên Web Dashboard
*   **Tổng quan (Overview)**: Thống kê nhanh tổng số lịch hẹn khám, tổng doanh thu cọc nhận được, số lịch hẹn tạm khóa đang chờ cọc và tổng số bệnh nhân. Biểu đồ 7 ngày gần nhất phản ánh hoạt động phòng khám.
*   **Lịch hẹn khám**: 
    *   Xem danh sách bệnh nhân đặt lịch theo ngày, lọc theo trạng thái (`Chờ cọc`, `Đã xác nhận`, `Đã khám`, `Đã hủy`).
    *   **Hành động**: Xác nhận lịch hẹn thủ công (nếu khách chuyển khoản sai nội dung), Đánh dấu khám xong (Check-in/Complete), Hủy lịch hẹn.
*   **Dịch vụ & Gói khám**: Admin có quyền thêm mới dịch vụ y tế, sửa tên, điều chỉnh đơn giá, đặt mức tiền cọc giữ chỗ cụ thể cho từng gói khám, bật/tắt hoặc xóa gói dịch vụ.
*   **Nhân viên phòng khám**: Quản lý tài khoản nhân viên (Lễ tân, Bác sĩ) và phân quyền tương ứng.

---

### B. QUẢN TRỊ NHANH QUA LỆNH CHAT TELEGRAM (ADMIN ONLY)
Các lệnh này chỉ có tác dụng khi gửi từ tài khoản Telegram của Admin chính (`ADMIN_ID`).

#### 1. Quản lý hệ thống
*   `/admin` — Mở bảng điều khiển admin nhanh qua chat.
*   `/dashboard` — Nhận link truy cập Dashboard quản trị.
*   `/seturl [URL]` — Cấu hình URL của máy chủ chạy bot.

#### 2. Quản lý ví tích điểm & Hoàn tiền cọc
Do tiền cọc được giữ trên ví tích điểm, khi bệnh nhân cần hủy lịch khám hợp lệ (trước 24h), Admin có thể hoàn tiền cọc về ví của họ bằng lệnh:
*   `/addbalance [Telegram_ID] [Số_tiền]` — Cộng tiền/Hoàn cọc vào ví của bệnh nhân (Ví dụ: `/addbalance 1076785545 100000`). Bệnh nhân sẽ nhận được tin nhắn thông báo ví đã được cộng tiền.
*   `/deductbalance [Telegram_ID] [Số_tiền]` — Trừ tiền trong ví của bệnh nhân (Ví dụ: trừ điểm phạt do hủy lịch sát giờ).

---

## 🛠️ PHẦN 3: ĐỒNG BỘ GOOGLE CALENDAR VÀ SEPAY WEBHOOK (KỸ THUẬT)

### 1. Đồng bộ Google Calendar
Khi lịch hẹn được xác nhận đặt cọc thành công (dù qua chuyển khoản VietQR hay thanh toán bằng ví số dư):
- Hệ thống tự động gọi Google Calendar API để tạo sự kiện khám mới.
- Tiêu đề sự kiện dạng: `🩺 [KHÁM] [Tên_bệnh_nhân] - [Tên_dịch_vụ]`.
- Phần mô tả sự kiện chứa mã lịch hẹn, số điện thoại liên hệ, số tiền cọc đã đóng để bác sĩ tiện kiểm tra lịch trực tiếp trên Google Lịch của điện thoại.

### 2. Hoạt động của Webhook SePay tự động
Mọi giao dịch chuyển khoản VietQR từ khách hàng đều được SePay bắn webhook về URL: `https://[DOMAIN_CỦA_BẠN]/webhook/sepay`.
*   Nếu nội dung giao dịch khớp với mã lịch hẹn `pending` (Ví dụ: `NAP PAY-A1B2C3`), hệ thống xác nhận lịch hẹn thành công, đồng bộ Google Calendar và báo tin nhắn Telegram.
*   Nếu nội dung giao dịch khớp với mã nạp ví `pending` trong bảng `deposits`, hệ thống tự động cộng tiền vào ví người dùng, cập nhật số dư mới và gửi thông báo biến động số dư.

---
*Tài liệu được cập nhật mới nhất vào ngày 25/06/2026 cho phiên bản CareBook-Bot.*
