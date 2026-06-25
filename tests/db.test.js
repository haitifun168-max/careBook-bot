const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/database');

test('Database - Check SQLite connection and schema integrity', () => {
    // Verify database can perform simple query
    const result = db.prepare("SELECT 1 + 1 as val").get();
    assert.strictEqual(result.val, 2);

    // Verify vital tables exist
    const tables = ['users', 'categories', 'products', 'appointments', 'clinic_hours', 'dashboard_users', 'deposits'];
    tables.forEach(table => {
        const info = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
        assert.ok(info, `Table '${table}' should exist in database schema`);
    });
});
