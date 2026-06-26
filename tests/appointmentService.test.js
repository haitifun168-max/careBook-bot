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

    test.before(async () => {
        // Wait for database initialization
        await db.initPromise;
        // Ensure test user exists
        await userService.findOrCreate(testUser);
        
        // Find a seed product to use
        const prodRes = await db.query('SELECT * FROM products LIMIT 1');
        product = prodRes.rows[0];
        assert.ok(product, 'Must have at least one product seeded in DB');
    });

    test.beforeEach(async () => {
        // Clean up any appointments for our test user
        await db.query('DELETE FROM appointments WHERE user_id = $1', [String(testUser.id)]);
    });

    test.after(async () => {
        await db.query('DELETE FROM appointments WHERE user_id = $1', [String(testUser.id)]);
        await db.query('DELETE FROM users WHERE telegram_id = $1', [String(testUser.id)]);
        await db.end();
    });

    test('create, getById, getByPaymentCode - basic workflow', async () => {
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

        const created = await appointmentService.create(appointmentData);
        assert.ok(created);
        assert.strictEqual(created.user_id, String(testUser.id));
        assert.strictEqual(created.patient_name, 'Test Patient');
        assert.strictEqual(created.status, 'pending');

        const retrieved = await appointmentService.getById(created.id);
        assert.ok(retrieved);
        assert.strictEqual(retrieved.payment_code, 'TEST-PAY-123');

        const retrievedByCode = await appointmentService.getByPaymentCode('TEST-PAY-123');
        assert.ok(retrievedByCode);
        assert.strictEqual(retrievedByCode.id, created.id);
    });

    test('getPendingByUser & getRecentByUser', async () => {
        const apt1 = await appointmentService.create({
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
        const pending = await appointmentService.getPendingByUser(testUser.id);
        assert.strictEqual(pending.length, 1);
        assert.strictEqual(pending[0].id, apt1.id);

        const recent = await appointmentService.getRecentByUser(testUser.id);
        assert.strictEqual(recent.length, 1);
        assert.strictEqual(recent[0].id, apt1.id);
    });

    test('confirmPayment, checkIn, cancel', async () => {
        const apt = await appointmentService.create({
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
        const confirmResult = await appointmentService.confirmPayment(apt.id, 'gcal-event-123');
        assert.strictEqual(confirmResult.success, true);
        assert.strictEqual(confirmResult.appointment.status, 'confirmed');
        assert.strictEqual(confirmResult.appointment.calendar_event_id, 'gcal-event-123');

        // Try double confirming
        const confirmResult2 = await appointmentService.confirmPayment(apt.id);
        assert.strictEqual(confirmResult2.success, false);

        // Check-in
        const checkInResult = await appointmentService.checkIn(apt.id);
        assert.strictEqual(checkInResult.success, true);
        assert.strictEqual(checkInResult.appointment.status, 'completed');

        // Try checking in again
        const checkInResult2 = await appointmentService.checkIn(apt.id);
        assert.strictEqual(checkInResult2.success, false);

        // Cancel
        const cancelResult = await appointmentService.cancel(apt.id);
        assert.strictEqual(cancelResult.success, true);
        const finalApt = await appointmentService.getById(apt.id);
        assert.strictEqual(finalApt.status, 'cancelled');
    });

    test('isSlotAvailable and getOccupiedSlotCounts', async () => {
        const dateStr = '2026-12-25';
        const timeLabel = '10:00 - 11:00';
        const maxCapacity = 2;

        // Slot is vacant initially
        assert.strictEqual(await appointmentService.isSlotAvailable(dateStr, timeLabel, maxCapacity), true);

        // Book slot first time
        await appointmentService.create({
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

        assert.strictEqual(await appointmentService.isSlotAvailable(dateStr, timeLabel, maxCapacity), true);

        // Book slot second time to hit capacity limit
        await appointmentService.create({
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
        assert.strictEqual(await appointmentService.isSlotAvailable(dateStr, timeLabel, maxCapacity), false);

        const counts = await appointmentService.getOccupiedSlotCounts(dateStr);
        assert.strictEqual(counts[timeLabel], 2);
    });

    test('cleanupExpiredAppointments - cancels pending older than 15 mins', async () => {
        // Manually insert an expired appointment
        await db.query(`
            INSERT INTO appointments (
                user_id, package_id, patient_name, patient_phone, 
                booking_date, booking_time, total_price, deposit_amount, 
                payment_code, status, created_at
            )
            VALUES ($1, $2, 'Expired Patient', '0000000000', '2026-10-10', '11:00 - 12:00', $3, $4, 'TEST-EXPIRED-CODE', 'pending', NOW() - INTERVAL '20 minutes')
        `, [String(testUser.id), product.id, product.price, product.deposit_amount]);

        const inserted = await appointmentService.getByPaymentCode('TEST-EXPIRED-CODE');
        assert.ok(inserted);
        assert.strictEqual(inserted.status, 'pending');

        // Run cleanup
        await appointmentService.cleanupExpiredAppointments();

        const updated = await appointmentService.getByPaymentCode('TEST-EXPIRED-CODE');
        assert.strictEqual(updated.status, 'cancelled');
    });
});
