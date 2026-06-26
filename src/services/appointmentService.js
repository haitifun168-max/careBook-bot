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

    await db.query(`
      UPDATE appointments 
      SET status = 'confirmed', paid_at = NOW(), calendar_event_id = $1, calendar_sync_status = $2
      WHERE id = $3
    `, [calendarEventId, calendarEventId ? 'synced' : 'pending', id]);

    return { success: true, appointment: await this.getById(id) };
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
  }
};

module.exports = appointmentService;
