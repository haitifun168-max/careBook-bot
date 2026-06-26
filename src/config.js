require('dotenv').config();

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    ADMIN_ID: parseInt(process.env.ADMIN_ID) || 0,
    PUBLIC_URL: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000',

    // Bank config for VietQR
    BANK: {
        BIN: process.env.BANK_BIN || '970422',
        ACCOUNT: process.env.BANK_ACCOUNT || '',
        ACCOUNT_NAME: process.env.BANK_ACCOUNT_NAME || '',
        NAME: process.env.BANK_NAME || 'MB',
    },

    BANK2: process.env.BANK2_ACCOUNT ? {
        BIN: process.env.BANK2_BIN || '970436',
        ACCOUNT: process.env.BANK2_ACCOUNT,
        ACCOUNT_NAME: process.env.BANK2_ACCOUNT_NAME || '',
        NAME: process.env.BANK2_NAME || 'VCB',
    } : null,

    // Payment
    WEBHOOK_PORT: parseInt(process.env.PORT) || parseInt(process.env.WEBHOOK_PORT) || 3000,
    SEPAY_API_KEY: process.env.SEPAY_API_KEY || '',
    DASHBOARD_TOKEN: process.env.DASHBOARD_TOKEN || require('crypto').randomBytes(16).toString('hex'),
    PAYMENT_PREFIX: process.env.PAYMENT_PREFIX || 'CB',
    PAYMENT_SECRET_KEY: BigInt(process.env.PAYMENT_SECRET_KEY || '123456789012345678'),

    // Zalo Chatbot
    ZALO_BOT_TOKEN: process.env.ZALO_BOT_TOKEN || '',
    ZALO_BOT_SECRET_TOKEN: process.env.ZALO_BOT_SECRET_TOKEN || '',

    // Google Calendar
    CLINIC_CALENDAR_ID: process.env.CLINIC_CALENDAR_ID || 'primary',
    SLOT_LOCK_MINUTES: 15,

    // Database Connection URL
    DATABASE_URL: process.env.DATABASE_URL || '',

    // Clinic Info
    SHOP_NAME: process.env.SHOP_NAME || 'CareBook Clinic',
    SUPPORT_CONTACT: process.env.SUPPORT_CONTACT || '@carebook_support',
};
