const db = require('../database');

const appointmentService = {
  /**
   * Create a new appointment
   */
  async create({ userId, packageId, patientName, patientPhone, bookingDate, bookingTime, totalPrice, depositAmount, paymentCode }) {
    const res = await db.query(`
      INSERT INTO appointments (
        user_id, package_id, patient_name, patient_phone, 
        booking_date, booking_time, total_price, deposit_amount, 
        payment_code, status, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW())
      RETURNING id
    `, [String(userId), packageId, patientName, patientPhone, bookingDate, bookingTime, totalPrice, depositAmount, paymentCode]);

    return await this.getById(res.rows[0].id);
  },

  /**
   * Get appointment by ID
   */
  async getById(id) {
    const res = await db.query(`
      SELECT a.*, a.user_id::text as user_id, p.name as package_name, p.emoji as package_emoji
      FROM appointments a
      JOIN products p ON a.package_id = p.id
      WHERE a.id = $1
    `, [id]);
    return res.rows[0] || null;
  },

  /**
   * Get appointment by payment code
   */
  async getByPaymentCode(code) {
    const cleanCode = code.replace(/[-\s]/g, '').toUpperCase();
    const res = await db.query(`
      SELECT a.*, a.user_id::text as user_id, p.name as package_name, p.emoji as package_emoji
      FROM appointments a
      JOIN products p ON a.package_id = p.id
      WHERE REPLACE(REPLACE(a.payment_code, '-', ''), ' ', '') = $1
    `, [cleanCode]);
    return res.rows[0] || null;
  },

  /**
   * Check if user has an active pending appointment (anti-spam slot lock)
   */
  async hasPending(userId) {
    const res = await db.query(`
      SELECT COUNT(*) as count FROM appointments
      WHERE user_id = $1 AND status = 'pending' AND created_at >= NOW() - INTERVAL '15 minutes'
    `, [String(userId)]);
    return parseInt(res.rows[0].count) > 0;
  },

  /**
   * Get user's pending appointments (active under 15 mins)
   */
  async getPendingByUser(userId) {
    const res = await db.query(`
      SELECT a.*, a.user_id::text as user_id, p.name as package_name
      FROM appointments a
      JOIN products p ON a.package_id = p.id
      WHERE a.user_id = $1 
        AND a.status = 'pending' 
        AND a.created_at >= NOW() - INTERVAL '15 minutes'
      ORDER BY a.created_at DESC
    `, [String(userId)]);
    return res.rows;
  },

  /**
   * Get user's recent appointments
   */
  async getRecentByUser(userId, limit = 5) {
    const res = await db.query(`
      SELECT a.*, a.user_id::text as user_id, p.name as package_name
      FROM appointments a
      JOIN products p ON a.package_id = p.id
      WHERE a.user_id = $1
      ORDER BY a.created_at DESC
      LIMIT $2
    `, [String(userId), limit]);
    return res.rows;
  },

  /**
   * Mark appointment as paid / confirmed
   */
  async confirmPayment(id, calendarEventId = null) {
    const appointment = await this.getById(id);
    if (!appointment) return { success: false, error: 'Lịch hẹn không tồn tại' };
    if (appointment.status !== 'pending') return { success: false, error: 'Lịch hẹn đã được xử lý trước đó' };

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // 1. Confirm the appointment
      await client.query(`
        UPDATE appointments 
        SET status = 'confirmed', paid_at = NOW(), calendar_event_id = $1, calendar_sync_status = $2
        WHERE id = $3
      `, [calendarEventId, calendarEventId ? 'synced' : 'pending', id]);

      // 2. Check if the user is a new user (has 0 completed appointments)
      const userId = appointment.user_id;
      const completedCountRes = await client.query(`
        SELECT COUNT(*) as count FROM appointments 
        WHERE user_id = $1 AND status = 'completed'
      `, [userId]);
      const isNewUser = parseInt(completedCountRes.rows[0].count) === 0;

      // 3. Find applicable campaign
      const campaignType = isNewUser ? 'attract' : 'retain';
      const campaignRes = await client.query(`
        SELECT * FROM marketing_campaigns 
        WHERE type = $1 AND is_active = 1 AND budget_spent + value <= budget_limit
        LIMIT 1
      `, [campaignType]);

      let promotionApplied = null;

      if (campaignRes.rows.length > 0) {
        const campaign = campaignRes.rows[0];
        
        // Record campaign usage
        await client.query(`
          INSERT INTO campaign_usages (campaign_id, user_id, appointment_id, amount_used)
          VALUES ($1, $2, $3, $4)
        `, [campaign.id, userId, id, campaign.value]);

        // Update campaign budget spent
        await client.query(`
          UPDATE marketing_campaigns 
          SET budget_spent = budget_spent + $1 
          WHERE id = $2
        `, [campaign.value, campaign.id]);

        // Add reward amount to user balance
        await client.query(`
          UPDATE users 
          SET balance = balance + $1 
          WHERE telegram_id = $2
        `, [campaign.value, userId]);

        promotionApplied = {
          campaignName: campaign.name,
          rewardType: campaign.reward_type,
          value: campaign.value
        };
      }

      await client.query('COMMIT');

      const updatedAppointment = await this.getById(id);
      return { success: true, appointment: updatedAppointment, promotionApplied };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('confirmPayment transaction error:', err.message);
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Mark appointment as checked-in (completed)
   */
  async checkIn(id) {
    const appointment = await this.getById(id);
    if (!appointment) return { success: false, error: 'Lịch hẹn không tồn tại' };
    if (appointment.status !== 'confirmed') return { success: false, error: 'Chỉ có thể check-in lịch hẹn đã xác nhận' };

    await db.query(`
      UPDATE appointments 
      SET status = 'completed', completed_at = NOW()
      WHERE id = $1
    `, [id]);

    return { success: true, appointment: await this.getById(id) };
  },

  /**
   * Cancel appointment
   */
  async cancel(id) {
    const appointment = await this.getById(id);
    if (!appointment) return { success: false, error: 'Lịch hẹn không tồn tại' };
    
    await db.query(`
      UPDATE appointments 
      SET status = 'cancelled'
      WHERE id = $1
    `, [id]);

    return { success: true };
  },

  /**
   * Get count of occupied slots for a given date
   */
  async getOccupiedSlotCounts(dateStr) {
    const res = await db.query(`
      SELECT booking_time, COUNT(*) as count
      FROM appointments
      WHERE booking_date = $1
        AND status != 'cancelled'
        AND (status != 'pending' OR created_at >= NOW() - INTERVAL '15 minutes')
      GROUP BY booking_time
    `, [dateStr]);

    const counts = {};
    res.rows.forEach(r => {
      counts[r.booking_time] = parseInt(r.count);
    });
    return counts;
  },

  /**
   * Get all clinic hours
   */
  async getClinicHours() {
    const res = await db.query('SELECT * FROM clinic_hours WHERE is_active = 1');
    return res.rows;
  },

  /**
   * Get clinic hour by ID
   */
  async getClinicHourById(id) {
    const res = await db.query('SELECT * FROM clinic_hours WHERE id = $1', [id]);
    return res.rows[0] || null;
  },

  /**
   * Check if a specific date and hour slot is available
   */
  async isSlotAvailable(dateStr, timeLabel, maxCapacity) {
    const res = await db.query(`
      SELECT COUNT(*) as count
      FROM appointments
      WHERE booking_date = $1
        AND booking_time = $2
        AND status != 'cancelled'
        AND (status != 'pending' OR created_at >= NOW() - INTERVAL '15 minutes')
    `, [dateStr, timeLabel]);

    return parseInt(res.rows[0].count) < maxCapacity;
  },

  /**
   * Create appointment safely using a PostgreSQL Transaction for concurrency locking
   */
  async createSafe(data) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      
      const hourRes = await client.query('SELECT max_capacity, is_active FROM clinic_hours WHERE time_label = $1', [data.bookingTime]);
      const hour = hourRes.rows[0];
      if (!hour || hour.is_active !== 1) throw new Error('SLOT_INACTIVE');
      
      const countRes = await client.query(`
        SELECT COUNT(*) as count FROM appointments
        WHERE booking_date = $1 AND booking_time = $2 AND status != 'cancelled'
          AND (status != 'pending' OR created_at >= NOW() - INTERVAL '15 minutes')
      `, [data.bookingDate, data.bookingTime]);
      
      const count = parseInt(countRes.rows[0].count);
      if (count >= hour.max_capacity) throw new Error('SLOT_FULL');
      
      const insertRes = await client.query(`
        INSERT INTO appointments (
          user_id, package_id, patient_name, patient_phone, 
          booking_date, booking_time, total_price, deposit_amount, 
          payment_code, status, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW())
        RETURNING id
      `, [String(data.userId), data.packageId, data.patientName, data.patientPhone, data.bookingDate, data.bookingTime, data.totalPrice, data.depositAmount, data.paymentCode]);
      
      await client.query('COMMIT');
      return insertRes.rows[0].id;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  /**
   * Cancel all pending appointments that are older than 15 minutes
   */
  async cleanupExpiredAppointments() {
    return await db.query(`
      UPDATE appointments
      SET status = 'cancelled'
      WHERE status = 'pending' AND created_at <= NOW() - INTERVAL '15 minutes'
    `);
  },

  /**
   * Get stats for Dashboard
   */
  async getStats() {
    const totalAppointmentsRes = await db.query("SELECT COUNT(*) as c FROM appointments WHERE status IN ('confirmed', 'completed')");
    const totalAppointments = parseInt(totalAppointmentsRes.rows[0].c);

    const totalRevenueRes = await db.query("SELECT COALESCE(SUM(deposit_amount), 0) as s FROM appointments WHERE status IN ('confirmed', 'completed')");
    const totalRevenue = parseInt(totalRevenueRes.rows[0].s);

    const pendingAppointmentsRes = await db.query(`
      SELECT COUNT(*) as c FROM appointments 
      WHERE status = 'pending' AND created_at >= NOW() - INTERVAL '15 minutes'
    `);
    const pendingAppointments = parseInt(pendingAppointmentsRes.rows[0].c);

    const totalUsersRes = await db.query('SELECT COUNT(*) as c FROM users');
    const totalUsers = parseInt(totalUsersRes.rows[0].c);

    return { totalAppointments, totalRevenue, pendingAppointments, totalUsers };
  },

  /**
   * Find pending appointments older than 10 mins but younger than 15 mins
   * that haven't been reminded, and notify users.
   */
  async sendBookingReminders(bot) {
    try {
      // Find appointments created between 10 and 15 minutes ago
      const pendingRes = await db.query(`
        SELECT a.*, p.name as package_name
        FROM appointments a
        JOIN products p ON a.package_id = p.id
        WHERE a.status = 'pending' 
          AND a.reminder_sent = 0
          AND a.created_at <= NOW() - INTERVAL '10 minutes'
          AND a.created_at > NOW() - INTERVAL '15 minutes'
      `);

      const pendingList = pendingRes.rows;
      if (pendingList.length === 0) return;

      console.log(`⏱️ Reminder Job: Tìm thấy ${pendingList.length} lịch hẹn chờ thanh toán cần nhắc nhở.`);

      const paymentService = require('./paymentService');

      for (const appt of pendingList) {
        const userId = appt.user_id;

        // Calculate remaining minutes dynamically (timeout is 15 minutes)
        const createdAt = new Date(appt.created_at);
        const elapsedMs = new Date() - createdAt;
        const totalTimeoutMs = 15 * 60 * 1000; // 15 minutes
        const remainingMs = totalTimeoutMs - elapsedMs;
        const remainingMinutes = Math.max(1, Math.ceil(remainingMs / (60 * 1000)));

        const qrUrl = paymentService.generateQRUrl(appt.deposit_amount, appt.payment_code);

        // Check if user is a new user (0 completed appointments)
        const completedCountRes = await db.query(`
          SELECT COUNT(*) as count FROM appointments 
          WHERE user_id = $1 AND status = 'completed'
        `, [userId]);
        const isNewUser = parseInt(completedCountRes.rows[0].count) === 0;

        let reminderText = '';
        if (isNewUser) {
          // Check if attract campaign is active and has budget
          const campaignRes = await db.query(`
            SELECT * FROM marketing_campaigns 
            WHERE type = 'attract' AND is_active = 1 AND budget_spent + value <= budget_limit
            LIMIT 1
          `);
          
          if (campaignRes.rows.length > 0) {
            const campaign = campaignRes.rows[0];
            const rewardVal = new Intl.NumberFormat('vi-VN').format(campaign.value) + 'đ';
            reminderText = `⏳ <b>NHẮC NHỞ ĐẶT LỊCH HẸN CHỜ THANH TOÁN (CÓ ƯU ĐÃI)</b>\n\n` +
              `Chào bạn, hệ thống nhận thấy bạn có một lịch hẹn chưa hoàn tất thanh toán cọc:\n` +
              `🩺 Dịch vụ: <b>${appt.package_name}</b>\n` +
              `📅 Thời gian: <b>${appt.booking_time} ngày ${appt.booking_date}</b>\n` +
              `💵 Số tiền cọc cần đóng: <b>${new Intl.NumberFormat('vi-VN').format(appt.deposit_amount)}đ</b>\n\n` +
              `🎁 <b>ĐẶC BIỆT DÀNH CHO BẠN:</b>\n` +
              `Do bạn là khách hàng mới đặt lịch lần đầu, nếu bạn hoàn tất thanh toán cọc trong vòng <b>${remainingMinutes} phút tới</b>, hệ thống sẽ <b>tặng ngay +${rewardVal} vào ví tích điểm</b> của bạn sau khi cọc thành công!\n\n` +
              `👉 Vui lòng quét mã QR chuyển khoản đính kèm để giữ chỗ. Quá 15 phút từ lúc đặt (chỉ còn lại <b>${remainingMinutes} phút</b>), lịch hẹn sẽ tự động bị hủy để nhường chỗ cho bệnh nhân khác.`;
          }
        }

        // If not new user or campaign is out of budget / inactive
        if (!reminderText) {
          reminderText = `⏳ <b>NHẮC NHỞ ĐẶT LỊCH HẸN CHỜ THANH TOÁN</b>\n\n` +
            `Chào bạn, lịch hẹn đặt chỗ của bạn sắp hết hạn giữ chỗ 15 phút:\n` +
            `🩺 Dịch vụ: <b>${appt.package_name}</b>\n` +
            `📅 Thời gian: <b>${appt.booking_time} ngày ${appt.booking_date}</b>\n` +
            `💵 Số tiền cọc cần đóng: <b>${new Intl.NumberFormat('vi-VN').format(appt.deposit_amount)}đ</b>\n\n` +
            `👉 Vui lòng quét mã QR chuyển khoản đính kèm để hoàn tất thanh toán cọc và giữ chỗ lịch khám. Quá 15 phút từ lúc đặt (chỉ còn lại <b>${remainingMinutes} phút</b>), lịch hẹn sẽ tự động bị hủy.`;
        }

        const isZalo = String(userId).length >= 12;
        try {
          if (isZalo) {
            const zaloBotService = require('./zaloBotService');
            await zaloBotService.sendPhoto(String(userId), qrUrl, 'Quét mã VietQR để thanh toán cọc giữ chỗ khám');
            await zaloBotService.sendMessage(String(userId), reminderText, 'html');
          } else {
            try {
              await bot.telegram.sendPhoto(userId, qrUrl, { caption: reminderText, parse_mode: 'HTML' });
            } catch (photoErr) {
              console.error(`⚠️ Gửi ảnh QR nhắc nhở thất bại cho Telegram #${appt.id}:`, photoErr.message);
              await bot.telegram.sendMessage(userId, reminderText, { parse_mode: 'HTML' });
            }
          }
          console.log(`✉️ Đã gửi tin nhắn nhắc nhở cọc kèm QR cho lịch hẹn #${appt.id} thành công cho khách hàng ${userId}`);
        } catch (err) {
          console.error(`❌ Lỗi khi gửi tin nhắc nhở cọc lịch hẹn #${appt.id} cho khách hàng:`, err.message);
        }

        // Mark as reminder_sent = 1
        await db.query('UPDATE appointments SET reminder_sent = 1 WHERE id = $1', [appt.id]);
      }
    } catch (err) {
      console.error('❌ Lỗi trong reminder job:', err.message);
    }
  }
};

module.exports = appointmentService;
