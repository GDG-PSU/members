import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redeemSignInLink, releaseSignInLink } from '@/lib/auth/sign-in-links';
import { withinRateLimit } from '@/lib/security/rate-limit';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';
import { confirmLinkAction } from './actions';

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServer: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/auth/sign-in-links', () => ({
  redeemSignInLink: vi.fn(),
  releaseSignInLink: vi.fn(),
}));
vi.mock('@/lib/security/rate-limit', () => ({ withinRateLimit: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

const verifyOtp = vi.fn();
const generateLink = vi.fn();
const token = 'a'.repeat(43);

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  verifyOtp.mockReset();
  generateLink.mockReset();
  vi.mocked(redeemSignInLink).mockReset();
  vi.mocked(releaseSignInLink).mockReset();
  vi.mocked(withinRateLimit).mockReset().mockResolvedValue(true);
  vi.mocked(createSupabaseServer).mockResolvedValue({ auth: { verifyOtp } } as never);
  vi.mocked(createSupabaseAdmin).mockReturnValue({ auth: { admin: { generateLink } } } as never);
});

describe('confirmLinkAction with a link the app issued', () => {
  const session = {
    data: { properties: { hashed_token: 'fresh', verification_type: 'recovery' } },
  };

  it('spends the link, starts a session and lands where the link is for', async () => {
    vi.mocked(redeemSignInLink).mockResolvedValue({
      linkId: 'link-1',
      email: 'a@psu.edu',
      purpose: 'member_invite',
    });
    generateLink.mockResolvedValue(session);
    verifyOtp.mockResolvedValue({ error: null });

    await expect(confirmLinkAction(form({ link: token }))).rejects.toThrow(
      'redirect:/invite/accept',
    );

    expect(redeemSignInLink).toHaveBeenCalledWith(token);
    expect(generateLink).toHaveBeenCalledWith({ type: 'recovery', email: 'a@psu.edu' });
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'fresh' });
    expect(releaseSignInLink).not.toHaveBeenCalled();
  });

  it('takes the destination from the link, never from the request', async () => {
    vi.mocked(redeemSignInLink).mockResolvedValue({
      linkId: 'link-2',
      email: 'a@psu.edu',
      purpose: 'recovery',
    });
    generateLink.mockResolvedValue(session);
    verifyOtp.mockResolvedValue({ error: null });

    await expect(confirmLinkAction(form({ link: token, next: '//evil.example' }))).rejects.toThrow(
      'redirect:/account/password',
    );
  });

  it('refuses a used, expired or unknown link without asking for a session', async () => {
    vi.mocked(redeemSignInLink).mockResolvedValue(null);

    await expect(confirmLinkAction(form({ link: token }))).rejects.toThrow(
      'redirect:/login?notice=invalid-link',
    );

    expect(generateLink).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('gives the link back when the session could not be started', async () => {
    vi.mocked(redeemSignInLink).mockResolvedValue({
      linkId: 'link-3',
      email: 'a@psu.edu',
      purpose: 'recovery',
    });
    generateLink.mockResolvedValue(session);
    verifyOtp.mockResolvedValue({ error: new Error('Auth is down') });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(confirmLinkAction(form({ link: token }))).rejects.toThrow(
      'redirect:/login?notice=invalid-link',
    );

    expect(releaseSignInLink).toHaveBeenCalledWith('link-3');
  });

  it('stops before spending anything when one address tries too often', async () => {
    vi.mocked(withinRateLimit).mockResolvedValue(false);

    await expect(confirmLinkAction(form({ link: token }))).rejects.toThrow(
      'redirect:/login?notice=invalid-link',
    );

    expect(redeemSignInLink).not.toHaveBeenCalled();
  });
});

describe('confirmLinkAction with a link made before the app issued its own', () => {
  it('spends the token and continues to the requested step', async () => {
    verifyOtp.mockResolvedValue({ error: null });

    await expect(
      confirmLinkAction(form({ tokenHash: 'hash', type: 'recovery', next: '/account/password' })),
    ).rejects.toThrow('redirect:/account/password');

    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'hash' });
    expect(redeemSignInLink).not.toHaveBeenCalled();
  });

  it('never redirects outside the allowed steps', async () => {
    verifyOtp.mockResolvedValue({ error: null });

    await expect(
      confirmLinkAction(form({ tokenHash: 'hash', type: 'invite', next: '//evil.example' })),
    ).rejects.toThrow('redirect:/invite/accept');
  });

  it('explains a used or expired link', async () => {
    verifyOtp.mockResolvedValue({ error: new Error('One-time token not found') });

    await expect(confirmLinkAction(form({ tokenHash: 'used', type: 'invite' }))).rejects.toThrow(
      'redirect:/login?notice=invalid-link',
    );
  });

  it('does not call Supabase for a malformed link', async () => {
    await expect(confirmLinkAction(form({ tokenHash: 'hash', type: 'nope' }))).rejects.toThrow(
      'redirect:/login?notice=invalid-link',
    );
    await expect(confirmLinkAction(form({ type: 'invite' }))).rejects.toThrow(
      'redirect:/login?notice=invalid-link',
    );

    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
