const config = require('../config');
const { customAlphabet } = require('nanoid');

const generateId = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 6);

function base36ToBigInt(str) {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = 0n;
    const cleanStr = String(str).toUpperCase().trim();
    for (let i = 0; i < cleanStr.length; i++) {
        const index = chars.indexOf(cleanStr[i]);
        if (index === -1) {
            throw new Error(`Invalid base36 character: ${cleanStr[i]}`);
        }
        result = result * 36n + BigInt(index);
    }
    return result;
}

const paymentService = {
    /**
     * Get available banks
     */
    getBanks() {
        const banks = [config.BANK];
        if (config.BANK2) banks.push(config.BANK2);
        return banks;
    },

    /**
     * Get bank by index (0 = BANK, 1 = BANK2)
     */
    getBank(index) {
        if (index === 1 && config.BANK2) return config.BANK2;
        return config.BANK;
    },

    /**
     * Generate unique payment code
     */
    generatePaymentCode(prefix = null) {
        const p = prefix || config.PAYMENT_PREFIX || 'CB';
        const cleanP = p.replace(/[-\s]/g, '');
        return `${cleanP}${generateId()}`;
    },

    /**
     * Mã hóa ID người dùng (Zalo ID / Telegram ID) thành chuỗi Base36 ngắn
     */
    encryptUserId(userId) {
        if (!userId) return '';
        const val = BigInt(userId);
        const mask = config.PAYMENT_SECRET_KEY || 123456789012345678n;
        
        // XOR với khóa bảo mật
        let obfuscated = val ^ mask;
        
        // Dịch chuyển vòng tròn trái 19 bits trên số nguyên 64-bit
        obfuscated = ((obfuscated << 19n) | (obfuscated >> 45n)) & 0xffffffffffffffffn;
        
        return obfuscated.toString(36).toUpperCase();
    },

    /**
     * Giải mã chuỗi Base36 ngược trở lại thành ID người dùng gốc
     */
    decryptUserId(code) {
        if (!code) return null;
        try {
            let obfuscated = base36ToBigInt(code);
            const mask = config.PAYMENT_SECRET_KEY || 123456789012345678n;
            
            // Dịch chuyển vòng tròn phải 19 bits (trái 45 bits) trên số nguyên 64-bit
            obfuscated = ((obfuscated >> 19n) | (obfuscated << 45n)) & 0xffffffffffffffffn;
            
            // XOR với khóa bảo mật
            const val = obfuscated ^ mask;
            return val.toString();
        } catch (e) {
            console.error('❌ Giải mã ID thất bại:', e.message);
            return null;
        }
    },

    /**
     * Generate VietQR image URL
     */
    generateQRUrl(amount, content, bank = null) {
        const b = bank || config.BANK;
        const encodedContent = encodeURIComponent(content);
        const encodedName = encodeURIComponent(b.ACCOUNT_NAME);

        return (
            `https://img.vietqr.io/image/${b.BIN}-${b.ACCOUNT}-compact2.png` +
            `?amount=${amount}` +
            `&addInfo=${encodedContent}` +
            `&accountName=${encodedName}`
        );
    },

    /**
     * Generate full QR payment info
     */
    generatePayment(amount, bankIndex = 0) {
        const bank = this.getBank(bankIndex);
        const paymentCode = this.generatePaymentCode();
        const qrUrl = this.generateQRUrl(amount, paymentCode, bank);

        return {
            paymentCode,
            qrUrl,
            bankName: bank.NAME,
            accountNumber: bank.ACCOUNT,
            accountName: bank.ACCOUNT_NAME,
            amount,
        };
    },
};

module.exports = paymentService;
