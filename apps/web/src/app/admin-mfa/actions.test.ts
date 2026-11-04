import { describe, expect, it, vi } from 'vitest';
import { getViewer } from '@/lib/auth/viewer';
import { enrollMfaAction } from './actions';

vi.mock('@/lib/auth/viewer', () => ({ getViewer: vi.fn() }));
vi.mock('@/lib/security/rate-limit', () => ({ withinRateLimit: vi.fn() }));
vi.mock('@/lib/env', () => ({ SITE_URL: 'https://members.example.test:8443' }));

describe('enrollMfaAction', () => {
  it('names the authenticator entry after the configured site', async () => {
    const enroll = vi.fn(async () => ({
      data: { id: 'factor', totp: { qr_code: 'qr', secret: 'secret' } },
      error: null,
    }));
    const listFactors = vi.fn(async () => ({ data: { all: [] } }));
    vi.mocked(getViewer).mockResolvedValue({
      user: { id: 'admin' },
      isAdmin: true,
      supabase: { auth: { mfa: { enroll, listFactors } } },
    } as never);

    await enrollMfaAction({}, new FormData());

    expect(enroll).toHaveBeenCalledWith(
      expect.objectContaining({ issuer: 'members.example.test' }),
    );
  });
});
