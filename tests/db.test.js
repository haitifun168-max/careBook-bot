const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/database');

test('Database - Check PostgreSQL connection and schema integrity', async () => {
    // Wait for database initialization
    await db.initPromise;
    // Verify database can perform simple query
    const result = await db.query("SELECT 1 + 1 as val");
    assert.strictEqual(parseInt(result.rows[0].val), 2);

    // Verify vital tables exist
    const tables = ['users', 'categories', 'products', 'appointments', 'clinic_hours', 'dashboard_users', 'deposits', 'sessions'];
    for (const table of tables) {
        const info = await db.query(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
            [table]
        );
        assert.ok(info.rows.length > 0, `Table '${table}' should exist in database schema`);
    }
    await db.end();
});
