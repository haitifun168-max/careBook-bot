const { Pool } = require('pg');
const config = require('./config');

if (!config.DATABASE_URL) {
  console.error('❌ DATABASE_URL chưa được cấu hình! Hãy cập nhật file .env');
  process.exit(1);
}

const parse = require('pg-connection-string').parse;
const poolConfig = parse(config.DATABASE_URL);
poolConfig.ssl = config.DATABASE_URL.includes('localhost') || config.DATABASE_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false };

const pool = new Pool(poolConfig);

const initDb = async () => {
  try {
    console.log('🔄 Đang kết nối và khởi tạo Cloud PostgreSQL...');
    
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id VARCHAR(255) PRIMARY KEY,
        username VARCHAR(255),
        full_name VARCHAR(255),
        balance INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        emoji VARCHAR(50) DEFAULT '📦',
        sort_order INTEGER DEFAULT 0
      );
    `);

    // Create products table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        price INTEGER NOT NULL,
        description TEXT,
        emoji VARCHAR(50) DEFAULT '📦',
        promotion VARCHAR(255),
        contact_only INTEGER DEFAULT 0,
        contact_url VARCHAR(255),
        sheet_stock INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        deposit_amount INTEGER DEFAULT 0
      );
    `);

    // Create appointments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) REFERENCES users(telegram_id) ON DELETE CASCADE,
        package_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
        patient_name VARCHAR(255) NOT NULL,
        patient_phone VARCHAR(50) NOT NULL,
        booking_date VARCHAR(50) NOT NULL,
        booking_time VARCHAR(50) NOT NULL,
        total_price INTEGER NOT NULL,
        deposit_amount INTEGER NOT NULL,
        payment_code VARCHAR(255) UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        calendar_event_id VARCHAR(255),
        calendar_sync_status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        paid_at TIMESTAMP,
        completed_at TIMESTAMP
      );
    `);

    // Create clinic_hours table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clinic_hours (
        id SERIAL PRIMARY KEY,
        time_label VARCHAR(50) UNIQUE NOT NULL,
        max_capacity INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1
      );
    `);

    // Create dashboard_users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dashboard_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        telegram_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create deposits table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS deposits (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) REFERENCES users(telegram_id) ON DELETE CASCADE,
        amount INTEGER NOT NULL,
        payment_code VARCHAR(255) UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      );
    `);

    // Create sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id VARCHAR(255) PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Alter appointments table to add reminder_sent if not exists
    await pool.query(`
      ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent INTEGER DEFAULT 0;
    `);

    // Create marketing_campaigns table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketing_campaigns (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        reward_type VARCHAR(50) NOT NULL,
        value INTEGER NOT NULL,
        budget_limit INTEGER NOT NULL,
        budget_spent INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create campaign_usages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS campaign_usages (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
        user_id VARCHAR(255) REFERENCES users(telegram_id) ON DELETE CASCADE,
        appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
        amount_used INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create database indexes for reporting optimization
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_appointments_user_status ON appointments(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_campaign_usages_campaign_id ON campaign_usages(campaign_id);
    `);

    // Seed categories
    const catCountRes = await pool.query('SELECT COUNT(*) as c FROM categories');
    if (parseInt(catCountRes.rows[0].c) === 0) {
      console.log('📦 Seeding initial clinic categories...');
      await pool.query("INSERT INTO categories (name, emoji, sort_order) VALUES ('Nha khoa thẩm mỹ', '🦷', 1)");
      await pool.query("INSERT INTO categories (name, emoji, sort_order) VALUES ('Tiểu phẫu & Điều trị', '🩺', 2)");
      await pool.query("INSERT INTO categories (name, emoji, sort_order) VALUES ('Chăm sóc tổng quát', '✨', 3)");
    }

    // Seed packages (products)
    const prodCountRes = await pool.query('SELECT COUNT(*) as c FROM products');
    if (parseInt(prodCountRes.rows[0].c) === 0) {
      console.log('📦 Seeding initial medical packages...');
      const insertProdSql = `
        INSERT INTO products (category_id, name, price, deposit_amount, emoji, promotion, description)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `;
      // Category 1: Nha khoa thẩm mỹ
      await pool.query(insertProdSql, [1, 'Tẩy trắng răng Laser', 1500000, 100000, '🦷', '🎁 Giảm 10% khi đặt trước', 'Tẩy trắng răng công nghệ Laser Whitening nhanh chóng, hiệu quả lâu dài.']);
      await pool.query(insertProdSql, [1, 'Bọc răng sứ Venus', 3000000, 200000, '👑', null, 'Răng sứ Venus nhập khẩu Đức, bảo hành 5 năm.']);
      // Category 2: Tiểu phẫu & Điều trị
      await pool.query(insertProdSql, [2, 'Nhổ răng khôn (không đau)', 1200000, 100000, '🩺', null, 'Nhổ răng khôn công nghệ Piezotome hạn chế sưng đau.']);
      await pool.query(insertProdSql, [2, 'Trị sâu răng / Trám răng', 300000, 50000, '🦷', null, 'Trám răng thẩm mỹ bằng chất liệu composite cao cấp.']);
      // Category 3: Chăm sóc tổng quát
      await pool.query(insertProdSql, [3, 'Lấy cao răng & Đánh bóng', 150000, 50000, '✨', null, 'Lấy cao răng siêu âm nhẹ nhàng, sạch mảng bám.']);
    }

    // Seed clinic hours
    const hoursCountRes = await pool.query('SELECT COUNT(*) as c FROM clinic_hours');
    if (parseInt(hoursCountRes.rows[0].c) === 0) {
      console.log('📅 Seeding clinic hours slots...');
      const insertHourSql = 'INSERT INTO clinic_hours (time_label, max_capacity) VALUES ($1, $2)';
      await pool.query(insertHourSql, ['08:00 - 09:00', 2]);
      await pool.query(insertHourSql, ['09:00 - 10:00', 2]);
      await pool.query(insertHourSql, ['10:00 - 11:00', 2]);
      await pool.query(insertHourSql, ['11:00 - 12:00', 2]);
      await pool.query(insertHourSql, ['13:30 - 14:30', 2]);
      await pool.query(insertHourSql, ['14:30 - 15:30', 2]);
      await pool.query(insertHourSql, ['15:30 - 16:30', 2]);
      await pool.query(insertHourSql, ['16:30 - 17:30', 1]);
    }

    // Seed default admin dashboard user
    const userCountRes = await pool.query('SELECT COUNT(*) as c FROM dashboard_users');
    if (parseInt(userCountRes.rows[0].c) === 0) {
      console.log('🔐 Seeding default admin dashboard user...');
      await pool.query(
        "INSERT INTO dashboard_users (username, password_hash, role) VALUES ($1, $2, $3)",
        ['admin', 'c1a2b3d4e5f67890:0420ac8de5c476a06648594bc97f832d37900f79f6cf5ff4790c7a95965018e05ba521ff202af4685c3d1cc32364c2e7452d6d2aa310f19e4ba834d9d934456f', 'admin']
      );
    }

    // Seed default marketing campaigns
    const campaignCountRes = await pool.query('SELECT COUNT(*) as c FROM marketing_campaigns');
    if (parseInt(campaignCountRes.rows[0].c) === 0) {
      console.log('📢 Seeding default marketing campaigns...');
      await pool.query(
        "INSERT INTO marketing_campaigns (name, type, reward_type, value, budget_limit) VALUES ($1, $2, $3, $4, $5)",
        ['Chiến dịch Thu hút khách mới', 'attract', 'cashback', 50000, 10000000]
      );
      await pool.query(
        "INSERT INTO marketing_campaigns (name, type, reward_type, value, budget_limit) VALUES ($1, $2, $3, $4, $5)",
        ['Chiến dịch Tri ân khách cũ', 'retain', 'cashback', 30000, 5000000]
      );
    }

    console.log('✅ Khởi tạo cơ sở dữ liệu PostgreSQL thành công!');
  } catch (error) {
    console.error('❌ Lỗi khởi tạo cơ sở dữ liệu PostgreSQL:', error);
    process.exit(1);
  }
};

const initPromise = initDb();
pool.initPromise = initPromise;

module.exports = pool;
