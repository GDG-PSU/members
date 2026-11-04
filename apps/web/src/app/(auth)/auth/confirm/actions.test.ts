import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseServer } from '@/lib/supabase/server';
import { confirmLinkAction } from './actions';

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServer: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

const verifyOtp = vi.fn();

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  verifyOtp.mockReset();
  vi.mocked(createSupabaseServer).mockResolvedValue({ auth: { verifyOtp } } as never);
});

describe('confirmLinkAction', () => {
  it('spends the token and continues to the requested step', async () => {
    verifyOtp.mockResolvedValue({ error: null });

    await expect(
      confirmLinkAction(form({ tokenHash: 'hash', type: 'recovery', next: '/account/password' })),
    ).rejects.toThrow('redirect:/account/password');

    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'hash' });
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
