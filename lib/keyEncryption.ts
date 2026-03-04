import crypto from 'crypto';

function getKek(): Buffer {
    const kek = process.env.KEY_ENCRYPTION_KEY;
    if (!kek) throw new Error('[PayVault] KEY_ENCRYPTION_KEY env var is not set');
    return Buffer.from(kek, 'hex');
}

// Encrypts { keyJWK, iv } using AES-256-GCM with the server KEK.
// Output format (base64): nonce(12) + authTag(16) + ciphertext
export function encryptKeyMaterial(keyJWK: JsonWebKey, iv: string): string {
    const kek = getKek();
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', kek, nonce);
    const plaintext = JSON.stringify({ keyJWK, iv });
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, tag, encrypted]).toString('base64');
}

// Decrypts the stored base64 blob back to { keyJWK, iv }
export function decryptKeyMaterial(stored: string): { keyJWK: JsonWebKey; iv: string } {
    const kek = getKek();
    const buf = Buffer.from(stored, 'base64');
    const nonce = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', kek, nonce);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return JSON.parse(plaintext);
}
