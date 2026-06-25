const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'shop.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    full_name TEXT,
    balance INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    emoji TEXT DEFAULT '📦',
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    description TEXT,
    emoji TEXT DEFAULT '📦',
    promotion TEXT,
    contact_only INTEGER DEFAULT 0,
    contact_url TEXT,
    sheet_stock INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    deposit_amount INTEGER DEFAULT 0,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    package_id INTEGER NOT NULL,
    patient_name TEXT NOT NULL,
    patient_phone TEXT NOT NULL,
    booking_date TEXT NOT NULL,
    booking_time TEXT NOT NULL,
    total_price INTEGER NOT NULL,
    deposit_amount INTEGER NOT NULL,
    payment_code TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'pending',
    calendar_event_id TEXT,
    calendar_sync_status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME,
    completed_at DATETIME,
    FOREIGN KEY (package_id) REFERENCES products(id),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS clinic_hours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time_label TEXT UNIQUE NOT NULL,
    max_capacity INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS dashboard_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,              -- 'admin', 'receptionist', 'doctor'
    telegram_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    payment_code TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
  );
`);

// Safe migrations for existing databases
try { db.exec('ALTER TABLE products ADD COLUMN contact_url TEXT'); } catch (e) { /* already exists */ }
try { db.exec('ALTER TABLE products ADD COLUMN sheet_stock INTEGER DEFAULT 0'); } catch (e) { /* already exists */ }
try { db.exec('ALTER TABLE products ADD COLUMN deposit_amount INTEGER DEFAULT 0'); } catch (e) { /* already exists */ }

// Seed categories if categories table is empty
const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get();
if (catCount.c === 0) {
  console.log('📦 Seeding initial clinic categories...');
  const insertCat = db.prepare('INSERT INTO categories (name, emoji, sort_order) VALUES (?, ?, ?)');
  insertCat.run('Nha khoa thẩm mỹ', '🦷', 1);
  insertCat.run('Tiểu phẫu & Điều trị', '🩺', 2);
  insertCat.run('Chăm sóc tổng quát', '✨', 3);
}

// Seed packages (products) if products table is empty
const prodCount = db.prepare('SELECT COUNT(*) as c FROM products').get();
if (prodCount.c === 0) {
  console.log('📦 Seeding initial medical packages...');
  const insertProd = db.prepare(`
    INSERT INTO products (category_id, name, price, deposit_amount, emoji, promotion, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  // Category 1: Nha khoa thẩm mỹ
  insertProd.run(1, 'Tẩy trắng răng Laser', 1500000, 100000, '🦷', '🎁 Giảm 10% khi đặt trước', 'Tẩy trắng răng công nghệ Laser Whitening nhanh chóng, hiệu quả lâu dài.');
  insertProd.run(1, 'Bọc răng sứ Venus', 3000000, 200000, '👑', null, 'Răng sứ Venus nhập khẩu Đức, bảo hành 5 năm.');
  
  // Category 2: Tiểu phẫu & Điều trị
  insertProd.run(2, 'Nhổ răng khôn (không đau)', 1200000, 100000, '🩺', null, 'Nhổ răng khôn công nghệ Piezotome hạn chế sưng đau.');
  insertProd.run(2, 'Trị sâu răng / Trám răng', 300000, 50000, '🦷', null, 'Trám răng thẩm mỹ bằng chất liệu composite cao cấp.');

  // Category 3: Chăm sóc tổng quát
  insertProd.run(3, 'Lấy cao răng & Đánh bóng', 150000, 50000, '✨', null, 'Lấy cao răng siêu âm nhẹ nhàng, sạch mảng bám.');
}

// Seed clinic hours if clinic_hours table is empty
const hoursCount = db.prepare('SELECT COUNT(*) as c FROM clinic_hours').get();
if (hoursCount.c === 0) {
  console.log('📅 Seeding clinic hours slots...');
  const insertHour = db.prepare('INSERT INTO clinic_hours (time_label, max_capacity) VALUES (?, ?)');
  insertHour.run('08:00 - 09:00', 2);
  insertHour.run('09:00 - 10:00', 2);
  insertHour.run('10:00 - 11:00', 2);
  insertHour.run('11:00 - 12:00', 2);
  insertHour.run('13:30 - 14:30', 2);
  insertHour.run('14:30 - 15:30', 2);
  insertHour.run('15:30 - 16:30', 2);
  insertHour.run('16:30 - 17:30', 1);
}

// Seed default admin dashboard user if dashboard_users is empty
const userCount = db.prepare('SELECT COUNT(*) as c FROM dashboard_users').get();
if (userCount.c === 0) {
  console.log('🔐 Seeding default admin dashboard user...');
  const insertUser = db.prepare('INSERT INTO dashboard_users (username, password_hash, role) VALUES (?, ?, ?)');
  // Default user: admin / admin123
  insertUser.run('admin', 'c1a2b3d4e5f67890:0420ac8de5c476a06648594bc97f832d37900f79f6cf5ff4790c7a95965018e05ba521ff202af4685c3d1cc32364c2e7452d6d2aa310f19e4ba834d9d934456f', 'admin');
}

module.exports = db;
