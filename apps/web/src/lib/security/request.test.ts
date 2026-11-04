import { describe, expect, it } from 'vitest';
import { clientAddress, hashForBucket, isSameOriginRequest, safeAuthNextPath } from './request';

const SITE = 'https://members.example.edu';

function post(headers: Record<string, string>) {
  return new Request('http://internal/api/auth/session', { method: 'POST', headers });
}

describe('safeAuthNextPath', () => {
  it('keeps allowlisted destinations', () => {
    for (const path of ['/invite/accept', '/admin-mfa', '/account/password', '/member']) {
      expect(safeAuthNextPath(path)).toBe(path);
    }
  });

  it('falls back for open-redirect attempts and unknown paths', () => {
    for (const path of [
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      '/member/../admin',
      '/admin',
      '',
      null,
      undefined,
    ]) {
      expect(safeAuthNextPath(path)).toBe('/invite/accept');
    }
  });
});

describe('isSameOriginRequest', () => {
  it('accepts the request host and the configured site origin', () => {
    expect(
      isSameOriginRequest(post({ origin: 'http://localhost:3000', host: 'localhost:3000' }), SITE),
    ).toBe(true);
    expect(
      isSameOriginRequest(
        post({ origin: 'https://preview.example', 'x-forwarded-host': 'preview.example' }),
        SITE,
      ),
    ).toBe(true);
    expect(isSameOriginRequest(post({ origin: SITE, host: 'internal' }), SITE)).toBe(true);
  });

  it('rejects other origins, a missing origin and malformed values', () => {
    expect(
      isSameOriginRequest(post({ origin: 'https://attacker.example', host: 'localhost' }), SITE),
    ).toBe(false);
    expect(isSameOriginRequest(post({ host: 'localhost' }), SITE)).toBe(false);
    expect(isSameOriginRequest(post({ origin: 'null', host: 'localhost' }), SITE)).toBe(false);
  });
});

describe('clientAddress', () => {
  it('uses the first forwarded address', () => {
    expect(clientAddress(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe(
      '203.0.113.9',
    );
    expect(
      clientAddress(
        new Headers({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '10.0.0.1' }),
      ),
    ).toBe('203.0.113.7');
  });

  it('falls back when no proxy header exists', () => {
    expect(clientAddress(new Headers({ 'x-real-ip': '203.0.113.5' }))).toBe('203.0.113.5');
    expect(clientAddress(new Headers())).toBe('unknown');
  });
});

describe('hashForBucket', () => {
  it('is stable and does not contain the input', () => {
    expect(hashForBucket('member@example.edu')).toBe(hashForBucket('member@example.edu'));
    expect(hashForBucket('member@example.edu')).not.toContain('member');
    expect(hashForBucket('a')).not.toBe(hashForBucket('b'));
  });
});
