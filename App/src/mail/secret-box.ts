import * as crypto from 'crypto';

/**
 * Encrypts a secret for storage in the database (AES-256-GCM). Used for the
 * mail password that the platform console saves, so a database dump or backup
 * does not carry a working mailbox login in plain text.
 *
 * The key comes from SETTINGS_ENCRYPTION_KEY, or — so nothing extra has to be
 * set up — from JWT_ACCESS_SECRET. Whichever is used must not change: a stored
 * password can only be read back with the key that locked it, and when that is
 * lost the password has to be typed in again.
 *
 * Stored as  v1.<iv>.<tag>.<ciphertext>  (all base64url).
 */
const PREFIX = 'v1';

function keyFrom(secret: string): Buffer {
  return crypto.createHash('sha256').update(`nghome-settings:${secret}`).digest();
}

export function encryptSecret(plain: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [PREFIX, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/** The original text, or null when the value is malformed or was locked with a different key. */
export function decryptSecret(stored: string, secret: string): string | null {
  const [prefix, iv, tag, ciphertext] = stored.split('.');
  if (prefix !== PREFIX || !iv || !tag || !ciphertext) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
