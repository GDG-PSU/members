import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { safeAuthNextPath } from '@/lib/security/request';
import { createSupabaseServer } from '@/lib/supabase/server';

const TYPES = new Set<EmailOtpType>([
  'invite',
  'recovery',
  'magiclink',
  'email',
  'email_change',
  'signup',
]);

/**
 * Confirms an emailed Supabase token on our own origin. Admin-generated
 * invite/recovery links use this route so they work on the production host
 * even when Supabase only allowlists localhost for redirects.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const next = safeAuthNextPath(url.searchParams.get('next'));

  if (!tokenHash || !type || !TYPES.has(type as EmailOtpType)) {
    return NextResponse.redirect(new URL('/login?notice=invalid-link', url.origin));
  }

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  });
  if (error) {
    return NextResponse.redirect(new URL('/login?notice=invalid-link', url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
