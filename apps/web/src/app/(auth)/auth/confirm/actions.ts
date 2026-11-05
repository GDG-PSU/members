'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { LINK_NEXT } from '@/lib/auth/link-rules';
import { redeemSignInLink, releaseSignInLink } from '@/lib/auth/sign-in-links';
import { withinRateLimit } from '@/lib/security/rate-limit';
import {
  clientAddress,
  hashForBucket,
  isEmailLinkType,
  safeAuthNextPath,
} from '@/lib/security/request';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

const INVALID_LINK = '/login?notice=invalid-link';

/** Spends the one-time link. Only pressing the button on the page reaches this. */
export async function confirmLinkAction(formData: FormData) {
  const token = String(formData.get('link') ?? '');
  if (token) {
    await confirmOwnLink(token);
    return;
  }

  // Links made before the app issued its own carry a Supabase token. They stop
  // working within a day of being made, so this branch has nothing left to serve
  // after 2026-11-08 and can be removed then.
  const tokenHash = String(formData.get('tokenHash') ?? '');
  const type = formData.get('type');
  if (!tokenHash || !isEmailLinkType(type)) redirect(INVALID_LINK);

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) redirect(INVALID_LINK);

  redirect(safeAuthNextPath(String(formData.get('next') ?? '')));
}

async function confirmOwnLink(token: string): Promise<never> {
  const address = hashForBucket(clientAddress(await headers()));
  if (!(await withinRateLimit(`link:ip:${address}`, 30, 300))) redirect(INVALID_LINK);

  const redeemed = await redeemSignInLink(token);
  if (!redeemed) redirect(INVALID_LINK);

  // The link is ours; the session is Supabase's. A token is made and used here,
  // in the same request, so its own short lifetime never matters.
  const generated = await createSupabaseAdmin().auth.admin.generateLink({
    type: 'recovery',
    email: redeemed.email,
  });
  const properties = generated.data?.properties;
  const type = properties?.verification_type;
  const supabase = await createSupabaseServer();
  const result =
    properties?.hashed_token && isEmailLinkType(type)
      ? await supabase.auth.verifyOtp({ type, token_hash: properties.hashed_token })
      : null;
  if (!result || result.error) {
    console.error(
      '[sign-in-link] session could not be started',
      generated.error?.message ?? result?.error?.message ?? 'no token returned',
    );
    // The failure is ours, so the person keeps a link that still works.
    await releaseSignInLink(redeemed.linkId);
    redirect(INVALID_LINK);
  }

  redirect(LINK_NEXT[redeemed.purpose]);
}
