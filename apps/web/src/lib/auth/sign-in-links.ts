import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { SITE_URL } from '@/lib/env';
import { LINK_HOURS, LINK_TOKEN, type LinkPurpose } from '@/lib/auth/link-rules';

export type IssuedLink = { link: string; expiresAt: string; hours: number };
export type LinkState = 'valid' | 'expired' | 'used' | 'unknown';

/** Only the hash is ever stored, so a database reader cannot use a link. */
export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Makes a one-time link for a person and replaces any earlier one. The caller
 * has already checked that the acting organizer may do this.
 */
export async function issueSignInLink(input: {
  purpose: LinkPurpose;
  authUserId: string;
  createdBy: string;
}): Promise<IssuedLink | null> {
  const token = randomBytes(32).toString('base64url');
  const hours = LINK_HOURS[input.purpose];
  const { data, error } = await createSupabaseAdmin().rpc('issue_sign_in_link', {
    p_token_hash: hashLinkToken(token),
    p_purpose: input.purpose,
    p_auth_user_id: input.authUserId,
    p_hours: hours,
    p_created_by: input.createdBy,
  });
  if (error || typeof data !== 'string') {
    console.error('[sign-in-link] could not be issued', error?.message);
    return null;
  }
  const url = new URL('/auth/confirm', SITE_URL);
  url.searchParams.set('link', token);
  return { link: url.toString(), expiresAt: data, hours };
}

/** Looks at a link without spending it, so the page can say what is wrong with it. */
export async function peekSignInLink(
  token: string,
): Promise<{ state: LinkState; purpose: LinkPurpose | null }> {
  if (!LINK_TOKEN.test(token)) return { state: 'unknown', purpose: null };
  const { data } = await createSupabaseAdmin()
    .from('sign_in_links')
    .select('purpose, expires_at, used_at')
    .eq('token_hash', hashLinkToken(token))
    .maybeSingle();
  if (!data) return { state: 'unknown', purpose: null };
  const purpose = data.purpose as LinkPurpose;
  if (data.used_at) return { state: 'used', purpose };
  if (new Date(data.expires_at as string).getTime() <= Date.now()) {
    return { state: 'expired', purpose };
  }
  return { state: 'valid', purpose };
}

/** Spends the link. Nothing comes back for one that is used, expired or unknown. */
export async function redeemSignInLink(
  token: string,
): Promise<{ linkId: string; email: string; purpose: LinkPurpose } | null> {
  if (!LINK_TOKEN.test(token)) return null;
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.rpc('redeem_sign_in_link', {
    p_token_hash: hashLinkToken(token),
  });
  const row = (Array.isArray(data) ? data[0] : data) as
    { link_id: string; auth_user_id: string; purpose: LinkPurpose } | null | undefined;
  if (error || !row) return null;

  const { data: owner } = await admin.auth.admin.getUserById(row.auth_user_id);
  const email = owner.user?.email;
  if (!email) {
    await releaseSignInLink(row.link_id);
    return null;
  }
  return { linkId: row.link_id, email, purpose: row.purpose };
}

/** Gives a link back when the failure was ours, so the person can try again. */
export async function releaseSignInLink(linkId: string): Promise<void> {
  const { error } = await createSupabaseAdmin()
    .from('sign_in_links')
    .update({ used_at: null })
    .eq('id', linkId);
  if (error) console.error('[sign-in-link] could not be released', error.message);
}
