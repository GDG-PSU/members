import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { clientAddress, hashForBucket } from '@/lib/security/request';
import { withinRateLimit } from '@/lib/security/rate-limit';
import { hashToken } from '@/lib/security/tokens';

export const dynamic = 'force-dynamic';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REDIRECT = { status: 307, headers: { 'Cache-Control': 'no-store' } };

export async function GET(request: Request, context: { params: Promise<{ cardToken: string }> }) {
  const origin = new URL(request.url).origin;
  const unavailable = () => NextResponse.redirect(new URL('/card-unavailable', origin), REDIRECT);
  const { cardToken } = await context.params;
  if (!TOKEN_PATTERN.test(cardToken)) {
    return unavailable();
  }

  // Keyed by client, not token: guessing a 256-bit token is not the risk, and a
  // per-token bucket would let anyone add a database row per random URL.
  const bucket = `card-lookup:${hashForBucket(clientAddress(request.headers))}`;
  if (!(await withinRateLimit(bucket, 120, 60))) {
    return unavailable();
  }

  // There is no direct FK from card_credentials to member_profiles; the profile
  // is reached through members. Embedding member_profiles directly here fails
  // and used to make every active card redirect to /card-unavailable.
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from('card_credentials')
    .select('status, member_id, members!inner(status, member_profiles!inner(profile_slug))')
    .eq('token_hash', hashToken(cardToken))
    .eq('status', 'active')
    .maybeSingle();
  if (error) {
    console.error('[card] lookup failed', error.message);
    return unavailable();
  }

  const member = Array.isArray(data?.members) ? data.members[0] : data?.members;
  const profile = Array.isArray(member?.member_profiles)
    ? member.member_profiles[0]
    : member?.member_profiles;
  if (!data || member?.status !== 'active' || !profile?.profile_slug) {
    return unavailable();
  }

  return NextResponse.redirect(new URL(`/m/${profile.profile_slug}`, origin), REDIRECT);
}
