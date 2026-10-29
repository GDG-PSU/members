import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { hashToken } from '@/lib/security/tokens';

export const dynamic = 'force-dynamic';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function GET(request: Request, context: { params: Promise<{ cardToken: string }> }) {
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

  // There is no direct FK from card_credentials to member_profiles; the profile
  // is reached through members. Embedding member_profiles directly here fails
  // and used to make every active card redirect to /card-unavailable.
  const { data, error } = await supabase
    .from('card_credentials')
    .select('status, member_id, members!inner(status, member_profiles!inner(profile_slug))')
    .eq('token_hash', hashToken(cardToken))
    .eq('status', 'active')
    .maybeSingle();
  if (error) {
    console.error('[card] lookup failed', error.message);
    return NextResponse.redirect(unavailable, 307);
  }

  const member = Array.isArray(data?.members) ? data.members[0] : data?.members;
  const profile = Array.isArray(member?.member_profiles)
    ? member.member_profiles[0]
    : member?.member_profiles;
  if (!data || member?.status !== 'active' || !profile?.profile_slug) {
    return NextResponse.redirect(unavailable, 307);
  }

  return NextResponse.redirect(new URL(`/m/${profile.profile_slug}`, origin), {
    status: 307,
    headers: { 'Cache-Control': 'no-store' },
  });
}
