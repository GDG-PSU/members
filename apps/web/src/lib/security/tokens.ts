import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { getEnv } from '@/lib/env';

const BASE64URL = 'base64url';

/** 144 bits of entropy → 24 URL-safe characters. */
export function generateProfileSlug(): string {
  return randomBytes(18).toString(BASE64URL);
}

/** 256 bits of entropy → 43 URL-safe characters (matches the device contract). */
export function generateCardToken(): string {
  return randomBytes(32).toString(BASE64URL);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

const NUMBER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateMemberNumber(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (const byte of bytes) {
    code += NUMBER_ALPHABET[byte % NUMBER_ALPHABET.length];
  }
  return `GDG-${code}`;
}

export function generateDeviceSecret(): string {
  return randomBytes(32).toString(BASE64URL);
}

function encryptionKey(): Buffer {
  const raw = getEnv().CARD_WRITE_ENCRYPTION_KEY;
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length === 32) return decoded;
  return createHash('sha256').update(raw, 'utf8').digest();
}

/**
 * AES-256-GCM envelope used for card tokens / one-time write payloads.
 * Format: v1.<iv>.<tag>.<ciphertext> (all base64url).
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString(BASE64URL),
    tag.toString(BASE64URL),
    ciphertext.toString(BASE64URL),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !dataPart) {
    throw new Error('Unsupported secret payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, BASE64URL));
  decipher.setAuthTag(Buffer.from(tagPart, BASE64URL));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, BASE64URL)),
    decipher.final(),
  ]).toString('utf8');
}

/** Constant-time comparison for device secrets. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
