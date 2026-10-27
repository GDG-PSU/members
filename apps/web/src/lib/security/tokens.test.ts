import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  generateCardToken,
  generateDeviceSecret,
  generateMemberNumber,
  generateProfileSlug,
  hashToken,
  safeEqual,
} from './tokens';

describe('profile and card tokens', () => {
  it('generates 24-character URL-safe profile slugs', () => {
    const slugs = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const slug = generateProfileSlug();
      expect(slug).toMatch(/^[A-Za-z0-9_-]{24}$/);
      slugs.add(slug);
    }
    expect(slugs.size).toBe(200);
  });

  it('generates 43-character card tokens accepted by the device contract', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const token = generateCardToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      tokens.add(token);
    }
    expect(tokens.size).toBe(100);
  });

  it('hashes tokens deterministically without leaking the token', () => {
    const token = generateCardToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
  });

  it('generates public member numbers without ambiguous characters', () => {
    for (let i = 0; i < 50; i += 1) {
      const number = generateMemberNumber();
      expect(number).toMatch(/^GDG-[A-HJ-NP-Z2-9]{6}$/);
    }
  });

  it('generates 256-bit device secrets', () => {
    const secret = generateDeviceSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('AES-256-GCM secret envelope', () => {
  it('round-trips and hides plaintext', () => {
    const plaintext = 'https://member.gdgpsu.dev/c/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
    const payload = encryptSecret(plaintext);
    expect(payload).not.toContain(plaintext);
    expect(payload.startsWith('v1.')).toBe(true);
    expect(decryptSecret(payload)).toBe(plaintext);
  });

  it('uses a unique IV per encryption', () => {
    const a = encryptSecret('same-value');
    const b = encryptSecret('same-value');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same-value');
    expect(decryptSecret(b)).toBe('same-value');
  });

  it('rejects tampered ciphertext', () => {
    const payload = encryptSecret('secret');
    const parts = payload.split('.');
    const tampered = [...parts];
    tampered[3] = `${parts[3]?.slice(0, -2)}AA`;
    expect(() => decryptSecret(tampered.join('.'))).toThrow();
  });

  it('rejects malformed payloads', () => {
    expect(() => decryptSecret('nope')).toThrow();
    expect(() => decryptSecret('v2.a.b.c')).toThrow();
  });
});

describe('safeEqual', () => {
  it('compares equal strings and rejects different lengths', () => {
    expect(safeEqual('abcd', 'abcd')).toBe(true);
    expect(safeEqual('abcd', 'abce')).toBe(false);
    expect(safeEqual('abcd', 'abcde')).toBe(false);
  });
});
