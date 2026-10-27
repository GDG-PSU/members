import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { hashToken } from '@/lib/security/tokens';

export const dynamic = 'force-dynamic';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function GET(
  request: Request,
  context: { params: Promise<{ cardToken: string }> },
) {
  const origin = new URL(request.url).origin;
  const unavailable = new URL('/card-unavailable', origin);
  const { cardToken } = await context.params;
  if (!TOKEN_PATTERN.test(cardToken)) {
    return NextResponse.redirect(unavailable, 307);
  }

  const supabase = createSupabaseAdmin();
  const allowed = await supabase.rpc('consume_rate_limit', {
    p_bucket: `card-lookup:${hashToken(cardToken).slice(0, 16)}`,
    p_limit: 30,
    p_window_seconds: 60,
  });
  if (allowed.data === false) {
    return NextResponse.redirect(unavailable, 307);
  }

  const { data } = await supabase
    .from('card_credentials')
    .select('status, member_id, member_profiles!inner(profile_slug)')
    .eq('token_hash', hashToken(cardToken))
    .eq('status', 'active')
    .maybeSingle();

  const profile = Array.isArray(data?.member_profiles) ? data?.member_profiles[0] : data?.member_profiles;
  if (!data || !profile?.profile_slug) {
    return NextResponse.redirect(unavailable, 307);
  }

  return NextResponse.redirect(new URL(`/m/${profile.profile_slug}`, origin), {
    status: 307,
    headers: { 'Cache-Control': 'no-store' },
  });
}
