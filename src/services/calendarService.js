const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Load thông tin xác thực Service Account
const CREDENTIALS_PATH = path.join(__dirname, '..', 'config', 'credentials.json');
let calendar = null;

// Ensure config dir exists
const configDir = path.join(__dirname, '..', 'config');
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Restore credentials.json dynamically from environment variables (useful for Render deployment)
if (process.env.GOOGLE_CREDENTIALS && !fs.existsSync(CREDENTIALS_PATH)) {
  try {
    const parsed = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(parsed, null, 2));
    console.log('📝 Đã khôi phục credentials.json từ biến môi trường GOOGLE_CREDENTIALS.');
  } catch (err) {
    console.error('❌ Lỗi khôi phục credentials.json từ GOOGLE_CREDENTIALS:', err.message);
  }
}

if (fs.existsSync(CREDENTIALS_PATH)) {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    calendar = google.calendar({ version: 'v3', auth });
    console.log('✅ Google Calendar Service đã sẵn sàng.');
  } catch (err) {
    console.error('❌ Lỗi khởi tạo Google Calendar Auth:', err.message);
  }
} else {
  console.log('⚠️ Cảnh báo: credentials.json không tồn tại trong thư mục src/config/. Tính năng đồng bộ Google Calendar bị tắt.');
}

const calendarService = {
  /**
   * Tạo sự kiện lịch khám mới khi khách thanh toán đặt cọc thành công
   */
  async createEvent(appointment, packageName) {
    if (!calendar) {
      console.log('ℹ️ Google Calendar chưa cấu hình, bỏ qua tạo sự kiện.');
      return { success: false, error: 'Calendar service not initialized' };
    }

    try {
      // Quy đổi giờ từ booking_time (ví dụ: "09:00 - 10:00")
      const times = appointment.booking_time.split(' - ');
      const startTime = times[0];
      const endTime = times[1];
      
      const event = {
        summary: `🩺 [KHÁM] ${appointment.patient_name} - ${packageName}`,
        description: `Mã lịch hẹn: #${appointment.id}\nSĐT liên hệ: ${appointment.patient_phone}\nSố tiền cọc: ${appointment.deposit_amount}đ\nĐặt qua Telegram Bot`,
        start: {
          dateTime: `${appointment.booking_date}T${startTime}:00`,
          timeZone: 'Asia/Ho_Chi_Minh',
        },
        end: {
          dateTime: `${appointment.booking_date}T${endTime}:00`,
          timeZone: 'Asia/Ho_Chi_Minh',
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 30 },
            { method: 'email', minutes: 60 }
          ],
        },
      };

      const response = await calendar.events.insert({
        calendarId: process.env.CLINIC_CALENDAR_ID || 'primary',
        resource: event,
      });

      console.log(`✅ Đã đồng bộ sự kiện đặt lịch #${appointment.id} sang Google Calendar (Event ID: ${response.data.id})`);
      return { success: true, eventId: response.data.id };
    } catch (err) {
      console.error('❌ Lỗi đồng bộ Google Calendar:', err.message);
      return { success: false, error: err.message };
    }
  },

  /**
   * Hủy sự kiện trên Google Calendar khi khách hoặc admin hủy lịch
   */
  async deleteEvent(eventId) {
    if (!calendar || !eventId) {
      return { success: false, error: 'Calendar service not initialized or missing eventId' };
    }

    try {
      await calendar.events.delete({
        calendarId: process.env.CLINIC_CALENDAR_ID || 'primary',
        eventId: eventId,
      });
      console.log(`✅ Đã xóa sự kiện Google Calendar (Event ID: ${eventId})`);
      return { success: true };
    } catch (err) {
      console.error('❌ Lỗi xóa sự kiện Google Calendar:', err.message);
      return { success: false, error: err.message };
    }
  }
};

module.exports = calendarService;
