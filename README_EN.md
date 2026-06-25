<p align="center">
  <img src="https://img.icons8.com/fluency/96/telegram-app.png" alt="Telegram Clinic Booking Bot" width="96"/>
</p>

<h1 align="center">🦷 CareBook Clinic Bot</h1>

<p align="center">
  <strong>Automated clinic & dentist booking system on Telegram with VietQR payment & Web Dashboard</strong><br/>
</p>

<p align="center">
  <a href="README.md">🇻🇳 Tiếng Việt</a> | <b>🇬🇧 English</b>
</p>

<p align="center">
  <a href="#-quick-setup"><img src="https://img.shields.io/badge/Setup-3_minutes-brightgreen?style=for-the-badge" alt="Setup"/></a>
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js"/>
  <img src="https://img.shields.io/badge/Telegraf-4.x-229ED9?style=flat-square&logo=telegram&logoColor=white" alt="Telegraf"/>
  <img src="https://img.shields.io/badge/SQLite-3-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite"/>
  <img src="https://img.shields.io/badge/VietQR-Payment-FF6B35?style=flat-square" alt="VietQR"/>
  <img src="https://img.shields.io/badge/Google_Calendar-Sync-4285F4?style=flat-square&logo=googlecalendar&logoColor=white" alt="Google Calendar"/>
</p>

---

## ✨ Features

- 📅 **Automated Appointment Booking**: Patients can select dental services, date, and available time slots dynamically via custom Telegram keyboards.
- 🔒 **Smart Time Slot Locking**: Selected slots are locked for 15 minutes waiting for deposit payment to prevent double bookings.
- 💳 **VietQR & SePay Webhook**: Generates QR codes containing exact deposit amounts and unique payment codes. Payments are verified automatically in 3-5 seconds.
- 💵 **Loyalty Wallet & Refund Credit**: Users have an internal wallet. It can be pre-funded, used for instant booking payments (bypassing VietQR), and credited for automated deposit refunds.
- 📆 **Google Calendar Integration**: Confirmed appointments are automatically synced to the clinic's Google Calendar in real-time.
- 🖥️ **Web Dashboard**: An administration portal supporting multiple roles (Admin, receptionist, doctor) to manage appointments, clinic services, and staff profiles.
- 🔑 **Telegram OTP Login**: Securely authenticate dashboard sessions using one-time passwords (OTP) sent directly to the Admin's Telegram account.
- 📢 **Broadcast Notifications**: Broadcasters can push rich HTML announcements to all registered users instantly.

---

## ⚡ Quick Setup

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- Telegram Bot Token (obtained from [@BotFather](https://t.me/BotFather))
- A bank account (VietQR automation registered via [SePay.vn](https://sepay.vn/))
- Google Cloud project credential files (`credentials.json`) for Calendar integration

### 1️⃣ Download & Install
```bash
git clone https://github.com/kentzu213/telegram-shop-bot.git careBook-bot
cd careBook-bot
npm install
```

### 2️⃣ Google Calendar Setup (Optional)
1. Go to Google Cloud Console, enable **Google Calendar API**.
2. Create a **Service Account**, download the private JSON credentials key, rename it to `credentials.json`.
3. Move `credentials.json` into the `src/config/` directory.
4. Share your Google Calendar (Calendar ID) with the service account email, giving it access to manage events.

### 3️⃣ Configure Environment Variables
```bash
cp .env.example .env
```
Open `.env` and fill in the details:
```env
BOT_TOKEN=your_bot_token_here
ADMIN_ID=your_telegram_id_here

# Bank information for deposit payments
BANK_BIN=970422
BANK_ACCOUNT=your_account_number
BANK_ACCOUNT_NAME=YOUR_FULL_NAME
BANK_NAME=MB

# Automation & Portal Config
SEPAY_API_KEY=your_sepay_key
DASHBOARD_TOKEN=your_dashboard_token
WEBHOOK_PORT=3000

# Calendar Config
CLINIC_CALENDAR_ID=primary

# Clinic Branding
SHOP_NAME=CareBook Clinic
SUPPORT_CONTACT=@your_support_username
```

### 4️⃣ Start the Bot
```bash
npm start
```
> 💡 Development hot-reload mode: `npm run dev`

---

## 📋 Telegram Commands

### 👤 Patient Commands
- `/start` - Start or reset the appointment booking wizard.
- `/menu` - View patient profile (ID, Wallet Balance, appointment counts).
- `/product` - List available dental services and treatment packages.
- `/nap` - Deposit funds into the loyalty wallet.
- `/checkpay` - Check status of your 5 recent appointments.
- `/support` - Contact medical support / clinic hotlines.
- `/myid` - Print your Telegram ID.

### 🔧 Admin Commands
- `/admin` - Quick administration overview.
- `/dashboard` - Request portal access link.
- `/seturl [URL]` - Set public URL of the bot webhook server.
- `/addbalance [ID] [Amount]` - Manually credit user's wallet (e.g. for refunding).
- `/deductbalance [ID] [Amount]` - Manually debit user's wallet.

---

## 📄 License
[MIT](LICENSE) © 2026 [kentzu213](https://github.com/kentzu213)
