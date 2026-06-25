const db = require('../database');

const appointmentService = {
  /**
   * Create a new appointment
   */
  create({ userId, packageId, patientName, patientPhone, bookingDate, bookingTime, totalPrice, depositAmount, paymentCode }) {
    const result = db.prepare(`
      INSERT INTO appointments (
        user_id, package_id, patient_name, patient_phone, 
        booking_date, booking_time, total_price, deposit_amount, 
        payment_code, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
    `).run(userId, packageId, patientName, patientPhone, bookingDate, bookingTime, totalPrice, depositAmount, paymentCode);

    return this.getById(result.lastInsertRowid);
  },

  /**
   * Get appointment by ID
   */
  getById(id) {
    return db.prepare(`
      SELECT a.*, CAST(a.user_id AS TEXT) as user_id, p.name as package_name, p.emoji as package_emoji
      FROM appointments a
      JOIN products p ON a.package_id = p.id
      WHERE a.id = ?
    `).get(id);
  },

  /**
   * Get appointment by payment code
   */
  getByPaymentCode(code) {
    const cleanCode = code.replace(/[-\s]/g, '').toUpperCase();
    return db.prepare(`
      SELECT a.*, CAST(a.user_id AS TEXT) as user_id, p.name as package_name, p.emoji as package_emoji
      FROM appointments a
      JOIN products p ON a.package_id = p.id
      WHERE REPLACE(REPLACE(a.payment_code, '-', ''), ' ', '') = ?
    `).get(cleanCode);
  },

  /**
   * Get user's pending appointments (active under 15 mins)
   */
  getPendingByUser(userId) {
    return db.prepare(`
      SELECT a.*, CAST(a.user_id AS TEXT) as user_id, p.name as package_name
      FROM appointments a
      JOIN products p ON a.package_id = p.id
      WHERE a.user_id = ? 
        AND a.status = 'pending' 
        AND a.created_at >= datetime('now', '-15 minutes')
      ORDER BY a.created_at DESC
    `).all(String(userId));
  },

  /**
   * Get user's recent appointments
   */
  getRecentByUser(userId, limit = 5) {
    return db.prepare(`
      SELECT a.*, CAST(a.user_id AS TEXT) as user_id, p.name as package_name
      FROM appointments a
      JOIN products p ON a.package_id = p.id
      WHERE a.user_id = ?
      ORDER BY a.created_at DESC
      LIMIT ?
    `).all(String(userId), limit);
  },

  /**
   * Mark appointment as paid / confirmed
   */
  confirmPayment(id, calendarEventId = null) {
    const appointment = this.getById(id);
    if (!appointment) return { success: false, error: 'Lịch hẹn không tồn tại' };
    if (appointment.status !== 'pending') return { success: false, error: 'Lịch hẹn đã được xử lý trước đó' };

    db.prepare(`
      UPDATE appointments 
      SET status = 'confirmed', paid_at = CURRENT_TIMESTAMP, calendar_event_id = ?, calendar_sync_status = ?
      WHERE id = ?
    `).run(calendarEventId, calendarEventId ? 'synced' : 'pending', id);

    return { success: true, appointment: this.getById(id) };
  },

  /**
   * Mark appointment as checked-in (completed)
   */
  checkIn(id) {
    const appointment = this.getById(id);
    if (!appointment) return { success: false, error: 'Lịch hẹn không tồn tại' };
    if (appointment.status !== 'confirmed') return { success: false, error: 'Chỉ có thể check-in lịch hẹn đã xác nhận' };

    db.prepare(`
      UPDATE appointments 
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);

    return { success: true, appointment: this.getById(id) };
  },

  /**
   * Cancel appointment
   */
  cancel(id) {
    const appointment = this.getById(id);
    if (!appointment) return { success: false, error: 'Lịch hẹn không tồn tại' };
    
    db.prepare(`
      UPDATE appointments 
      SET status = 'cancelled'
      WHERE id = ?
    `).run(id);

    return { success: true };
  },

  /**
   * Get count of occupied slots for a given date
   * Returns object: { "08:00 - 09:00": 2, "09:00 - 10:00": 1 }
   */
  getOccupiedSlotCounts(dateStr) {
    const rows = db.prepare(`
      SELECT booking_time, COUNT(*) as count
      FROM appointments
      WHERE booking_date = ?
        AND status != 'cancelled'
        AND (status != 'pending' OR created_at >= datetime('now', '-15 minutes'))
      GROUP BY booking_time
    `).all(dateStr);

    const counts = {};
    rows.forEach(r => {
      counts[r.booking_time] = r.count;
    });
    return counts;
  },

  /**
   * Get all clinic hours
   */
  getClinicHours() {
    return db.prepare('SELECT * FROM clinic_hours WHERE is_active = 1').all();
  },

  /**
   * Get clinic hour by ID
   */
  getClinicHourById(id) {
    return db.prepare('SELECT * FROM clinic_hours WHERE id = ?').get(id);
  },

  /**
   * Check if a specific date and hour slot is available
   */
  isSlotAvailable(dateStr, timeLabel, maxCapacity) {
    const result = db.prepare(`
      SELECT COUNT(*) as count
      FROM appointments
      WHERE booking_date = ?
        AND booking_time = ?
        AND status != 'cancelled'
        AND (status != 'pending' OR created_at >= datetime('now', '-15 minutes'))
    `).get(dateStr, timeLabel);

    return result.count < maxCapacity;
  },

  /**
   * Cancel all pending appointments that are older than 15 minutes
   */
  cleanupExpiredAppointments() {
    return db.prepare(`
      UPDATE appointments
      SET status = 'cancelled'
      WHERE status = 'pending' AND created_at <= datetime('now', '-15 minutes')
    `).run();
  },

  /**
   * Get stats for Dashboard
   */
  getStats() {
    const totalAppointments = db.prepare("SELECT COUNT(*) as c FROM appointments WHERE status IN ('confirmed', 'completed')").get().c;
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(deposit_amount), 0) as s FROM appointments WHERE status IN ('confirmed', 'completed')").get().s;
    const pendingAppointments = db.prepare(`
      SELECT COUNT(*) as c FROM appointments 
      WHERE status = 'pending' AND created_at >= datetime('now', '-15 minutes')
    `).get().c;
    const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;

    return { totalAppointments, totalRevenue, pendingAppointments, totalUsers };
  }
};

module.exports = appointmentService;
