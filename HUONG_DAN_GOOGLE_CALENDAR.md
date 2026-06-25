# 📅 HƯỚNG DẪN CẤU HÌNH ĐỒNG BỘ GOOGLE CALENDAR VỚI GMAIL: haiti.fun168@gmail.com

Tài liệu này hướng dẫn chi tiết cách thiết lập Google Calendar API bằng phương pháp Service Account (Tài khoản dịch vụ) để tự động đồng bộ lịch khám của CareBook Bot vào tài khoản Google Lịch cá nhân của bạn (`haiti.fun168@gmail.com`).

---

## 📌 PHẦN 1: Tạo dự án & Lấy file `credentials.json` từ Google Cloud

CareBook Bot sử dụng thư viện chính thức của Google để kết nối y tế bảo mật qua Service Account. Để lấy tệp cấu hình xác thực, vui lòng thực hiện các bước sau:

1. **Truy cập Google Cloud Console**:
   - Đăng nhập trình duyệt bằng tài khoản Google của bạn.
   - Truy cập liên kết: [Google Cloud Console](https://console.cloud.google.com/).

2. **Tạo dự án mới (New Project)**:
   - Nhấp vào danh sách chọn dự án ở góc trên cùng bên trái màn hình.
   - Nhấn **New Project** (Dự án mới).
   - Đặt tên cho dự án (Ví dụ: `CareBook Calendar Sync`) và nhấn **Create** (Tạo). Đợi vài giây để dự án được khởi tạo xong rồi chọn dự án vừa tạo.

3. **Bật Google Calendar API**:
   - Tìm kiếm từ khóa **Google Calendar API** trên thanh tìm kiếm ở đầu trang.
   - Nhấp chọn **Google Calendar API** trong danh sách kết quả.
   - Nhấn nút **Enable** (Kích hoạt) để bật API này cho dự án.

4. **Tạo tài khoản dịch vụ (Service Account)**:
   - Nhấp vào biểu tượng menu (3 dấu gạch ngang) ở góc trên bên trái -> Chọn **APIs & Services** -> Chọn **Credentials** (Thông tin xác thực).
   - Ở hàng trên cùng, nhấn nút **+ Create Credentials** -> Chọn **Service Account** (Tài khoản dịch vụ).
   - Điền thông tin:
     - **Service account name**: Nhập tên gợi nhớ (Ví dụ: `carebook-bot`).
     - **Service account ID**: Hệ thống sẽ tự động tạo một địa chỉ email robot dạng: `carebook-bot@<project-id>.iam.gserviceaccount.com`.
   - Nhấn **Create and Continue** (Tạo và tiếp tục).
   - Ở các bước tiếp theo (phần phân quyền vai trò tùy chọn), bạn có thể để trống và nhấn **Continue** rồi nhấn **Done** để hoàn tất.

5. **Tải tệp khóa xác thực JSON (`credentials.json`)**:
   - Vẫn tại màn hình **Credentials**, tìm mục **Service Accounts** ở phía cuối trang.
   - Nhấp vào địa chỉ email robot bạn vừa tạo ở bước trên.
   - Chuyển sang tab **Keys** (Khóa) ở thanh menu phụ phía trên.
   - Nhấn nút **Add Key** -> Chọn **Create new key** (Tạo khóa mới).
   - Chọn định dạng là **JSON**, sau đó nhấn **Create** (Tạo).
   - Trình duyệt sẽ tự động tải về một tệp tin dạng `.json` (Ví dụ: `carebook-calendar-sync-xxxx.json`).

6. **Đặt khóa vào đúng thư mục dự án**:
   - Đổi tên tệp tin `.json` vừa tải về thành: `credentials.json`
   - Sao chép tệp `credentials.json` này vào thư mục `src/config/` của dự án CareBook Bot.
     - Đường dẫn đầy đủ cục bộ: `src/config/credentials.json`
     - **Lưu ý quan trọng**: Tệp này chứa mã khóa bí mật, không commit tệp này lên các kho lưu trữ công khai như GitHub (tệp này mặc định đã được thêm vào `.gitignore` để bảo mật).

---

## 🔒 PHẦN 2: Chia sẻ lịch Gmail `haiti.fun168@gmail.com` cho Robot

Mặc định, tài khoản robot (Service Account) của bạn chưa có quyền ghi chép lên lịch cá nhân của bạn. Bạn cần thực hiện chia sẻ lịch của mình cho email robot này:

1. **Lấy email của Service Account**:
   - Mở tệp `credentials.json` bạn vừa tải về bằng một trình soạn thảo văn bản bất kỳ (như Notepad).
   - Tìm dòng chứa `"client_email"` và sao chép địa chỉ email robot đó (Ví dụ: `carebook-bot@xxxxxxxx.iam.gserviceaccount.com`).

2. **Truy cập Google Calendar cá nhân**:
   - Đăng nhập vào hòm thư Gmail `haiti.fun168@gmail.com`.
   - Truy cập vào ứng dụng [Google Calendar (Lịch)](https://calendar.google.com/).

3. **Cấu hình Chia sẻ quyền quản lý lịch**:
   - Nhìn sang cột bên trái ở mục **My calendars** (Lịch của tôi).
   - Di chuột đến lịch chính của bạn (Thường trùng tên với Gmail hoặc tên bạn), nhấp vào biểu tượng **3 dấu chấm dọc** bên cạnh lịch -> Chọn **Settings and sharing** (Cài đặt và chia sẻ).
   - Cuộn xuống phần **Share with specific people or groups** (Chia sẻ với những người hoặc nhóm cụ thể).
   - Nhấp chọn **+ Add people and groups** (Thêm người và nhóm).
   - **Dán (Paste)** địa chỉ email Service Account đã sao chép ở Bước 1 vào ô trống.
   - Trong mục **Permissions** (Quyền), hãy chọn: **Make changes to events** (Thực hiện thay đổi đối với các sự kiện).
     - *Quyền này cho phép bot tự động thêm lịch hẹn mới và xóa lịch hẹn khi khách hủy.*
   - Nhấn **Send** (Gửi) để hoàn thành chia sẻ.

---

## ⚙️ PHẦN 3: Thiết lập cấu hình biến môi trường Lịch

1. **Lấy ID Lịch (Calendar ID)**:
   - Vẫn ở trang cài đặt lịch cá nhân đó, cuộn tiếp xuống mục **Integrate calendar** (Tích hợp lịch).
   - Tìm dòng **Calendar ID** (Mã nhận dạng lịch).
     - *Nếu bạn dùng lịch cá nhân mặc định, Calendar ID chính là email của bạn:* `haiti.fun168@gmail.com`.
     - *Nếu bạn tự tạo một Lịch riêng phụ đặt tên là "Lịch Khám CareBook", mã Calendar ID sẽ có dạng đuôi `@group.calendar.google.com`.*
   - Sao chép mã nhận dạng lịch này.

2. **Cập nhật tệp cấu hình `.env`**:
   - Mở file `.env` ở thư mục gốc dự án CareBook Bot.
   - Tìm biến `CLINIC_CALENDAR_ID` và gán giá trị Calendar ID bạn vừa copy:
     ```env
     CLINIC_CALENDAR_ID=haiti.fun168@gmail.com
     ```
   - Nhấn Lưu file `.env` lại.
   - Nếu dự án chạy trên Render, hãy truy cập vào bảng điều khiển Render của bạn, vào mục **Environment** và cập nhật biến môi trường `CLINIC_CALENDAR_ID` với giá trị tương ứng.

---

## 🔬 PHẦN 4: Kiểm tra hoạt động đồng bộ

Sau khi hoàn thành 3 phần trên, hãy khởi động lại CareBook Bot:
1. Bạn sẽ thấy dòng log xác nhận lúc khởi động bot:
   ```bash
   ✅ Google Calendar Service đã sẵn sàng.
   ```
2. Thử tạo một lịch hẹn mới trên Telegram hoặc Zalo Bot và chuyển khoản đặt cọc thử.
3. Khi giao dịch được xác nhận (Đã thanh toán), hãy mở Google Lịch của bạn lên kiểm tra. Bạn sẽ thấy một sự kiện mới xuất hiện đúng ngày giờ với tiêu đề:
   `🩺 [KHÁM] [Tên Bệnh Nhân] - [Tên gói dịch vụ]`
4. Khi lịch hẹn được đánh dấu là Hủy trên Dashboard hoặc qua lệnh Admin, sự kiện tương ứng trên Google Lịch cũng sẽ tự động được xóa bỏ để giải phóng khung giờ trống.
