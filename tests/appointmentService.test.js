const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/database');
const appointmentService = require('../src/services/appointmentService');
const userService = require('../src/services/userService');

test.describe('AppointmentService Tests', () => {
    const testUser = {
        id: 99999902,
        username: 'test_user_appointment',
        first_name: 'Nguyen Van',
        last_name: 'Appointment'
    };

    let product = null;

    test.before(() => {
        // Ensure test user exists
        userService.findOrCreate(testUser);
        
        // Find a seed product to use
        product = db.prepare('SELECT * FROM products LIMIT 1').get();
        assert.ok(product, 'Must have at least one product seeded in DB');
    });

    test.beforeEach(() => {
        // Clean up any appointments for our test user
        db.prepare('DELETE FROM appointments WHERE user_id = ?').run(String(testUser.id));
    });

    test.after(() => {
        db.prepare('DELETE FROM appointments WHERE user_id = ?').run(String(testUser.id));
        db.prepare('DELETE FROM users WHERE telegram_id = ?').run(String(testUser.id));
    });

    test('create, getById, getByPaymentCode - basic workflow', () => {
        const appointmentData = {
            userId: testUser.id,
            packageId: product.id,
            patientName: 'Test Patient',
            patientPhone: '0987654321',
            bookingDate: '2026-10-10',
            bookingTime: '08:00 - 09:00',
            totalPrice: product.price,
            depositAmount: product.deposit_amount,
            paymentCode: 'TEST-PAY-123'
        };

        const created = appointmentService.create(appointmentData);
        assert.ok(created);
        assert.strictEqual(created.user_id, String(testUser.id));
        assert.strictEqual(created.patient_name, 'Test Patient');
        assert.strictEqual(created.status, 'pending');

        const retrieved = appointmentService.getById(created.id);
        assert.ok(retrieved);
        assert.strictEqual(retrieved.payment_code, 'TEST-PAY-123');

        const retrievedByCode = appointmentService.getByPaymentCode('TEST-PAY-123');
        assert.ok(retrievedByCode);
        assert.strictEqual(retrievedByCode.id, created.id);
    });

    test('getPendingByUser & getRecentByUser', () => {
        const apt1 = appointmentService.create({
            userId: testUser.id,
            packageId: product.id,
            patientName: 'Patient 1',
            patientPhone: '0987654321',
            bookingDate: '2026-10-10',
            bookingTime: '08:00 - 09:00',
            totalPrice: product.price,
            depositAmount: product.deposit_amount,
            paymentCode: 'TEST-APT-1'
        });

        // The pending appointments list should return apt1
        const pending = appointmentService.getPendingByUser(testUser.id);
        assert.strictEqual(pending.length, 1);
        assert.strictEqual(pending[0].id, apt1.id);

        const recent = appointmentService.getRecentByUser(testUser.id);
        assert.strictEqual(recent.length, 1);
        assert.strictEqual(recent[0].id, apt1.id);
    });

    test('confirmPayment, checkIn, cancel', () => {
        const apt = appointmentService.create({
            userId: testUser.id,
            packageId: product.id,
            patientName: 'State Patient',
            patientPhone: '0987654321',
            bookingDate: '2026-10-10',
            bookingTime: '09:00 - 10:00',
            totalPrice: product.price,
            depositAmount: product.deposit_amount,
            paymentCode: 'TEST-STATE-1'
        });

        // Check initial state
        assert.strictEqual(apt.status, 'pending');

        // Confirm payment
        const confirmResult = appointmentService.confirmPayment(apt.id, 'gcal-event-123');
        assert.strictEqual(confirmResult.success, true);
        assert.strictEqual(confirmResult.appointment.status, 'confirmed');
        assert.strictEqual(confirmResult.appointment.calendar_event_id, 'gcal-event-123');

        // Try double confirming
        const confirmResult2 = appointmentService.confirmPayment(apt.id);
        assert.strictEqual(confirmResult2.success, false);

        // Check-in
        const checkInResult = appointmentService.checkIn(apt.id);
        assert.strictEqual(checkInResult.success, true);
        assert.strictEqual(checkInResult.appointment.status, 'completed');

        // Try checking in again
        const checkInResult2 = appointmentService.checkIn(apt.id);
        assert.strictEqual(checkInResult2.success, false);

        // Cancel
        const cancelResult = appointmentService.cancel(apt.id);
        assert.strictEqual(cancelResult.success, true);
        const finalApt = appointmentService.getById(apt.id);
        assert.strictEqual(finalApt.status, 'cancelled');
    });

    test('isSlotAvailable and getOccupiedSlotCounts', () => {
        const dateStr = '2026-12-25';
        const timeLabel = '10:00 - 11:00';
        const maxCapacity = 2;

        // Slot is vacant initially
        assert.strictEqual(appointmentService.isSlotAvailable(dateStr, timeLabel, maxCapacity), true);

        // Book slot first time
        appointmentService.create({
            userId: testUser.id,
            packageId: product.id,
            patientName: 'Slot Patient 1',
            patientPhone: '0987654321',
            bookingDate: dateStr,
            bookingTime: timeLabel,
            totalPrice: product.price,
            depositAmount: product.deposit_amount,
            paymentCode: 'TEST-SLOT-1'
        });

        assert.strictEqual(appointmentService.isSlotAvailable(dateStr, timeLabel, maxCapacity), true);

        // Book slot second time to hit capacity limit
        appointmentService.create({
            userId: testUser.id,
            packageId: product.id,
            patientName: 'Slot Patient 2',
            patientPhone: '0987654321',
            bookingDate: dateStr,
            bookingTime: timeLabel,
            totalPrice: product.price,
            depositAmount: product.deposit_amount,
            paymentCode: 'TEST-SLOT-2'
        });

        // Capacity is 2, so it should be full now
        assert.strictEqual(appointmentService.isSlotAvailable(dateStr, timeLabel, maxCapacity), false);

        const counts = appointmentService.getOccupiedSlotCounts(dateStr);
        assert.strictEqual(counts[timeLabel], 2);
    });

    test('cleanupExpiredAppointments - cancels pending older than 15 mins', () => {
        // Manually insert an expired appointment using raw database prepare
        db.prepare(`
            INSERT INTO appointments (
                user_id, package_id, patient_name, patient_phone, 
                booking_date, booking_time, total_price, deposit_amount, 
                payment_code, status, created_at
            )
            VALUES (?, ?, 'Expired Patient', '0000000000', '2026-10-10', '11:00 - 12:00', ?, ?, 'TEST-EXPIRED-CODE', 'pending', datetime('now', '-20 minutes'))
        `).run(String(testUser.id), product.id, product.price, product.deposit_amount);

        const inserted = appointmentService.getByPaymentCode('TEST-EXPIRED-CODE');
        assert.ok(inserted);
        assert.strictEqual(inserted.status, 'pending');

        // Run cleanup
        appointmentService.cleanupExpiredAppointments();

        const updated = appointmentService.getByPaymentCode('TEST-EXPIRED-CODE');
        assert.strictEqual(updated.status, 'cancelled');
    });
});
