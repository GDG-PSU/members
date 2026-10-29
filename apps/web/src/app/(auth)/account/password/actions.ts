'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

export type PasswordState = { error?: string };

const schema = z
  .object({
    password: z
      .string()
      .min(12, 'Use at least 12 characters.')
      .max(128, 'Use 128 characters or fewer.'),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'The passwords do not match.',
    path: ['confirmPassword'],
  });

export async function updatePasswordAction(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const viewer = await getViewer();
  if (!viewer.user) {
    return { error: 'Your sign-in link has expired. Ask an organizer for a new one.' };
  }

  const parsed = schema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the new password.' };
  }

  const { error } = await viewer.supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: 'Your password could not be updated. The link may have expired.' };
  }

  await createSupabaseAdmin()
    .rpc('log_audit', {
      p_actor: viewer.user.id,
      p_action: 'auth.password_updated',
      p_target_type: 'user',
      p_target_id: viewer.user.id,
      p_reason: null,
      p_before: null,
      p_after: null,
      p_request_id: null,
    })
    .then(
      () => undefined,
      () => undefined,
    );

  redirect(viewer.isAdmin ? '/admin-mfa' : '/member');
}
