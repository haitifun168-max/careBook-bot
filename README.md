<p align="center">
  <img src="https://img.icons8.com/fluency/96/telegram-app.png" alt="Telegram Clinic Booking Bot" width="96"/>
</p>

<h1 align="center">🦷 CareBook Clinic Bot</h1>

<p align="center">
  <strong>Hệ thống đặt lịch khám tự động trên Telegram tích hợp cổng thanh toán VietQR & Web Dashboard</strong><br/>
  <em>Dentist & Clinic Telegram Booking Bot with VietQR deposit payment, Google Calendar sync & Admin Dashboard</em>
</p>

<p align="center">
  <b>🇻🇳 Tiếng Việt</b> | <a href="README_EN.md">🇬🇧 English</a>
</p>

<p align="center">
  <a href="#-cài-đặt-nhanh"><img src="https://img.shields.io/badge/Cài_đặt-3_phút-brightgreen?style=for-the-badge" alt="Setup"/></a>
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js"/>
  <img src="https://img.shields.io/badge/Telegraf-4.x-229ED9?style=flat-square&logo=telegram&logoColor=white" alt="Telegraf"/>
  <img src="https://img.shields.io/badge/SQLite-3-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite"/>
  <img src="https://img.shields.io/badge/VietQR-Payment-FF6B35?style=flat-square" alt="VietQR"/>
  <img src="https://img.shields.io/badge/Google_Calendar-Sync-4285F4?style=flat-square&logo=googlecalendar&logoColor=white" alt="Google Calendar"/>
</p>

---

## ✨ Tính năng nổi bật

| Tính năng | Mô tả |
|-----------|--------|
| 📅 **Đặt lịch khám tự động** | Khách hàng tự chọn dịch vụ, ngày hẹn và khung giờ trống trực quan qua bàn phím Telegram. |
| 🔒 **Khóa giờ hẹn thông minh** | Khung giờ đã chọn sẽ tạm khóa trong 15 phút chờ đặt cọc để tránh trùng lịch hẹn. |
| 💳 **QR VietQR & SePay** | Tạo mã QR cọc tự động chứa nội dung xác thực giao dịch, tự động duyệt lịch sau 3-5 giây. |
| 💵 **Ví tích điểm & Hoàn tiền** | Người dùng có ví số dư (tích điểm/cashback). Có thể dùng ví thanh toán cọc trực tiếp hoặc nhận hoàn tiền tự động khi hủy lịch khám hợp lệ. |
| 📆 **Google Calendar Sync** | Tự động đồng bộ các lịch khám đã nhận cọc sang Google Lịch của phòng khám thời gian thực. |
| 🖥️ **Web Dashboard quản trị** | Phân hệ trực quan dành cho Admin, Bác sĩ, Lễ tân để quản lý lịch hẹn, dịch vụ, nhân viên phòng khám. |
| 🔑 **Telegram OTP Login** | Đăng nhập an toàn vào Web Dashboard bằng mã xác thực một lần (OTP) gửi thẳng đến Telegram Admin. |
| 📢 **Broadcast tin nhắn** | Admin gửi thông báo hàng loạt đến tất cả người dùng hệ thống. |

---

## 🔄 Luồng đăng ký đặt lịch khám

```
Khách: /start → Chọn Gói Dịch Vụ → Chọn Ngày → Chọn Khung Giờ → Nhập Tên/SĐT
                                       ↓
                           Hệ thống hiển thị hóa đơn
                                       ↓
   ┌───────────────────────────────────┴───────────────────────────────────┐
   ▼ (Có đủ số dư ví tích điểm)                                            ▼ (Thanh toán trực tiếp)
💵 Chọn "Thanh toán bằng ví"                                       💳 Bot tạo QR VietQR đặt cọc
   │                                                                       │ (Hạn chót thanh toán: 15 phút)
   ▼                                                                       ▼
Trừ ví & Xác nhận ngay ✅                                           Khách quét mã → Webhook SePay duyệt
   │                                                                       │
   └───────────────────────────────────┬───────────────────────────────────┘
                                       ▼
                       Đồng bộ sang Google Calendar 📅
                       Gửi thông báo thành công cho Khách & Admin 🎉
```

---

## ⚡ Cài đặt nhanh

### Yêu cầu
- [Node.js](https://nodejs.org/) v18 trở lên
- Telegram Bot Token (từ [@BotFather](https://t.me/BotFather))
- Một tài khoản ngân hàng (hỗ trợ VietQR tích hợp qua [SePay.vn](https://sepay.vn/))
- Dự án Google Cloud (để lấy Service Account `credentials.json` kết nối Google Calendar)

### 1️⃣ Tải mã nguồn & Cài đặt
```bash
git clone https://github.com/kentzu213/telegram-shop-bot.git careBook-bot
cd careBook-bot
npm install
```

### 2️⃣ Thiết lập Google Calendar (Tùy chọn)
1. Tạo dự án trên Google Cloud Console, bật **Google Calendar API**.
2. Tạo **Service Account**, tải tệp khóa dạng JSON xuống và đổi tên thành `credentials.json`.
3. Di chuyển tệp `credentials.json` vào thư mục `src/config/`.
4. Chia sẻ lịch Google của bạn (Calendar ID) với email của Service Account và cấp quyền sửa đổi sự kiện.

### 3️⃣ Cấu hình biến môi trường
```bash
cp .env.example .env
```
Mở tệp `.env` và cập nhật các thông số cần thiết:
```env
BOT_TOKEN=8965098425:AAHm...  # Bot Token từ @BotFather
ADMIN_ID=1076785545           # Telegram ID của Admin chính để nhận OTP đăng nhập

# Thông tin tài khoản nhận cọc
BANK_BIN=970422               # Mã ngân hàng (MB là 970422)
BANK_ACCOUNT=0967818656       # Số tài khoản
BANK_ACCOUNT_NAME=Pham Huy Cuong
BANK_NAME=MB

# Cấu hình thanh toán tự động & Dashboard
SEPAY_API_KEY=SP_KEY_...      # Lấy từ SePay.vn để xác thực webhook bảo mật
DASHBOARD_TOKEN=SP_KEY_...    # Token bí mật đăng nhập Dashboard nhanh từ Telegram
WEBHOOK_PORT=3000

# Lịch đồng bộ Google Calendar
CLINIC_CALENDAR_ID=primary    # Google Calendar ID (email lịch chính)

# Thông tin phòng khám
SHOP_NAME=CareBook Clinic
SUPPORT_CONTACT=@cuongph1
```

### 4️⃣ Chạy ứng dụng
```bash
npm start
```
> 💡 Khởi chạy chế độ phát triển (Tự động tải lại khi đổi code): `npm run dev`

---

## 📋 Danh sách Lệnh Telegram

<details>
<summary><b>👤 Lệnh Bệnh nhân (Người dùng)</b></summary>

| Lệnh | Phím Menu tương ứng | Mô tả |
|-------|--------------------|--------|
| `/start` | 📅 **Đặt lịch khám** | Bắt đầu hoặc khởi động lại luồng đặt lịch khám. |
| `/menu` | 👤 **Tài khoản** | Xem thông tin cá nhân (ID, Số dư ví tích điểm, số lịch hẹn đã đặt). |
| `/product` | 🩺 **Dịch vụ & Gói khám** | Danh sách dịch vụ phòng khám đang cung cấp. |
| `/nap` | 💰 **Nạp tiền** | Yêu cầu nạp thêm tiền/điểm vào ví tích điểm. |
| `/checkpay` | 🔍 **Lịch khám của bạn** | Xem danh sách và trạng thái của 5 lịch hẹn khám gần nhất. |
| `/support` | 🆘 **Hỗ trợ** | Thông tin liên hệ, hotline phòng khám. |
| `/myid` | - | Lấy Telegram ID cá nhân. |

</details>

<details>
<summary><b>🔧 Lệnh Admin (Quản trị viên)</b></summary>

| Lệnh | Cách dùng | Mô tả |
|-------|----------|--------|
| `/admin` | `/admin` | Tổng quan điều khiển nhanh qua chat. |
| `/dashboard` | `/dashboard` | Lấy liên kết truy cập nhanh trang Web Dashboard quản trị. |
| `/seturl` | `/seturl [URL]` | Cấu hình URL công khai của máy chủ chứa bot. |
| `/addbalance` | `/addbalance [Telegram_ID] [Số_tiền]` | Cộng tiền/Hoàn cọc thủ công cho bệnh nhân. |
| `/deductbalance` | `/deductbalance [Telegram_ID] [Số_tiền]` | Trừ tiền thủ công trong ví của bệnh nhân. |

</details>

---

## 🖥️ Web Dashboard Quản trị

Giao diện Web Dashboard (`/admin/login` hoặc truy cập qua `/dashboard`) hỗ trợ phân quyền người dùng (Role-based access control - RBAC) chặt chẽ:
- **Admin**: Quản lý toàn quyền toàn bộ lịch hẹn, thống kê doanh thu cọc, thêm/sửa/tắt gói dịch vụ và quản lý nhân sự phòng khám.
- **Receptionist (Lễ tân)**: Theo dõi lịch hẹn trong ngày, check-in đón bệnh nhân và xác nhận lịch hẹn trực quan.
- **Doctor (Bác sĩ)**: Theo dõi danh sách bệnh nhân đặt khám theo ngày.

---

## 🤝 Đóng góp ý kiến
Mọi yêu cầu đóng góp hay báo cáo lỗi, vui lòng liên hệ:
- 💬 **Telegram**: [@cuongph1](https://t.me/cuongph1)
- 📄 **Giấy phép**: [MIT](LICENSE)
