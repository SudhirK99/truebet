const crypto = require('crypto');


const decryptMiddleware = (req, res, next) => {
    try {
        const privateKey = process.env.DECRYPTION_PRIVATE_KEY || "4f720809232700e33163cc981ca95bf4";
        if (!privateKey) {
            throw new Error('Server encryption key not found');
        }

        if (!req.body || !req.body.encryptedData || !req.body.iv) {
            return res.status(400).json({ error: 'Missing encrypted data parameters' });
        }

        const { encryptedData, iv } = req.body;

        // Convert Base64 to Buffers
        const ivBuffer = Buffer.from(iv, 'base64');
        const encryptedBuffer = Buffer.from(encryptedData, 'base64');

        // Ensure key is exactly 32 bytes (256 bits)
        let keyBuffer = Buffer.from(privateKey, 'utf8').slice(0, 32);
        if (keyBuffer.length !== 32) {
            const paddedKey = Buffer.alloc(32); // Creates a buffer of 32 bytes filled with zeros
            keyBuffer.copy(paddedKey); // Copies the original key into the padded buffer
            keyBuffer = paddedKey;
        }

        // The last 16 bytes of the encrypted data is the auth tag for GCM
        const authTag = encryptedBuffer.slice(-16);
        const encryptedContent = encryptedBuffer.slice(0, -16);

        // Create decipher
        const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, ivBuffer);
        decipher.setAuthTag(authTag);

        // Decrypt the data
        let decrypted = '';
        try {
            decrypted = decipher.update(encryptedContent, null, 'utf8');
            decrypted += decipher.final('utf8');
        } catch (e) {
            console.error('Decryption operation failed:', e);
            throw e;
        }

        // Parse the decrypted data
        const decryptedData = JSON.parse(decrypted);

        // Replace the encrypted request body with decrypted data
        req.body = decryptedData;

        next();
    } catch (error) {
        console.error('Decryption error details:', {
            message: error.message,
            stack: error.stack,
            ivPresent: !!req.body?.iv,
            encryptedDataPresent: !!req.body?.encryptedData,
            keyPresent: !!process.env.DECRYPTION_PRIVATE_KEY
        });

        return res.status(400).json({
            error: 'Decryption failed: ' + error.message,
            details: {
                ivLength: req.body?.iv ? Buffer.from(req.body.iv, 'base64').length : null,
                encryptedDataLength: req.body?.encryptedData ? Buffer.from(req.body.encryptedData, 'base64').length : null,
                keyLength: process.env.DECRYPTION_PRIVATE_KEY ? Buffer.from(process.env.DECRYPTION_PRIVATE_KEY, 'utf8').length : null
            }
        });
    }
};

module.exports = { decryptMiddleware };