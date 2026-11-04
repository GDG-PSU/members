'use server';

import { redirect } from 'next/navigation';
import { isEmailLinkType, safeAuthNextPath } from '@/lib/security/request';
import { createSupabaseServer } from '@/lib/supabase/server';

const INVALID_LINK = '/login?notice=invalid-link';

/** Spends the one-time token. Only pressing the button on the page reaches this. */
export async function confirmLinkAction(formData: FormData) {
  const tokenHash = String(formData.get('tokenHash') ?? '');
  const type = formData.get('type');
  if (!tokenHash || !isEmailLinkType(type)) redirect(INVALID_LINK);

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) redirect(INVALID_LINK);

  redirect(safeAuthNextPath(String(formData.get('next') ?? '')));
}
