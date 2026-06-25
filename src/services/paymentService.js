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
        const idStr = String(userId).trim();
        const isHex = !/^\d+$/.test(idStr);
        let val;
        if (isHex) {
            val = BigInt('0x' + idStr);
        } else {
            val = BigInt(idStr);
        }

        // Encode format info in the least significant bit
        let encoded = val * 2n + (isHex ? 1n : 0n);
        const mask = config.PAYMENT_SECRET_KEY || 123456789012345678n;
        
        // XOR with mask directly to support arbitrary bit lengths
        let obfuscated = encoded ^ mask;
        
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
            
            let encoded = obfuscated ^ mask;
            
            const isHex = (encoded % 2n) === 1n;
            const val = encoded / 2n;
            
            if (isHex) {
                return val.toString(16);
            } else {
                return val.toString(10);
            }
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
