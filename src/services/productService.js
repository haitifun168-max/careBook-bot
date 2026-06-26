const db = require('../database');

const productService = {
    /**
     * Get all active products (clinic packages)
     */
    async getAll() {
        const res = await db.query(`
            SELECT p.*
            FROM products p
            WHERE p.is_active = 1
            ORDER BY p.category_id, p.id
        `);
        return res.rows;
    },

    /**
     * Get single product by ID
     */
    async getById(id) {
        const res = await db.query(`
            SELECT p.*
            FROM products p
            WHERE p.id = $1
        `, [id]);
        return res.rows[0] || null;
    },

    /**
     * Get products by category
     */
    async getByCategory(categoryId) {
        const res = await db.query(`
            SELECT p.*
            FROM products p
            WHERE p.category_id = $1 AND p.is_active = 1
            ORDER BY p.id
        `, [categoryId]);
        return res.rows;
    },

    /**
     * Get all categories
     */
    async getCategories() {
        const res = await db.query('SELECT * FROM categories ORDER BY sort_order');
        return res.rows;
    },

    /**
     * Add a new product
     */
    async addProduct(categoryId, name, price, depositAmount = 0, emoji = '🩺', promotion = null, description = null) {
        const res = await db.query(`
            INSERT INTO products (category_id, name, price, deposit_amount, emoji, promotion, description, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
            RETURNING id
        `, [categoryId, name, price, depositAmount, emoji, promotion, description]);
        return res.rows[0].id;
    },
};

module.exports = productService;
