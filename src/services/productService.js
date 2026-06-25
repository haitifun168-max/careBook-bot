const db = require('../database');

const productService = {
    /**
     * Get all active products (clinic packages)
     */
    getAll() {
        return db.prepare(`
            SELECT p.*
            FROM products p
            WHERE p.is_active = 1
            ORDER BY p.category_id, p.id
        `).all();
    },

    /**
     * Get single product by ID
     */
    getById(id) {
        return db.prepare(`
            SELECT p.*
            FROM products p
            WHERE p.id = ?
        `).get(id);
    },

    /**
     * Get products by category
     */
    getByCategory(categoryId) {
        return db.prepare(`
            SELECT p.*
            FROM products p
            WHERE p.category_id = ? AND p.is_active = 1
            ORDER BY p.id
        `).all(categoryId);
    },

    /**
     * Get all categories
     */
    getCategories() {
        return db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
    },

    /**
     * Add a new product
     */
    addProduct(categoryId, name, price, depositAmount = 0, emoji = '🩺', promotion = null, description = null) {
        const result = db.prepare(`
            INSERT INTO products (category_id, name, price, deposit_amount, emoji, promotion, description, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `).run(categoryId, name, price, depositAmount, emoji, promotion, description);
        return result.lastInsertRowid;
    },
};

module.exports = productService;
