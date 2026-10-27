'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { storeProfilePhoto, PhotoError } from '@/lib/profile/photo';
import { generateMemberNumber, generateProfileSlug } from '@/lib/security/tokens';

const setupSchema = z
  .object({
    displayName: z.string().trim().min(2, 'Use at least 2 characters').max(60),
    about: z.string().trim().max(280).optional().default(''),
    password: z
      .string()
      .min(12, 'Use at least 12 characters')
      .max(128)
      .refine((value) => /[a-zA-Z]/.test(value) && /\d/.test(value), {
        message: 'Include at least one letter and one number',
      }),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export interface SetupState {
  error?: string;
}

export async function completeSetupAction(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const viewer = await requireUser();
  if (viewer.member) redirect('/member');

  const parsed = setupSchema.safeParse({
    displayName: formData.get('displayName'),
    about: formData.get('about') ?? '',
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  if (formData.get('acceptTerms') !== 'on') {
    return { error: 'Please confirm the privacy and card terms.' };
  }

  const photo = formData.get('photo');
  if (!(photo instanceof File) || photo.size === 0) {
    return { error: 'Add a profile photo.' };
  }

  let photoPath: string;
  try {
    photoPath = await storeProfilePhoto(photo, viewer.user.id);
  } catch (error) {
    return { error: error instanceof PhotoError ? error.message : 'Photo upload failed.' };
  }

  const { error: passwordError } = await viewer.supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (passwordError) {
    return { error: 'Your password could not be set. The invitation may have expired.' };
  }

  const email = (viewer.user.email ?? '').toLowerCase();
  const admin = createSupabaseAdmin();
  let memberId: string | null = null;
  let lastError = 'Could not complete membership setup.';

  for (let attempt = 0; attempt < 4 && !memberId; attempt += 1) {
    const { data, error } = await admin.rpc('complete_member_setup', {
      p_auth_user_id: viewer.user.id,
      p_email: email,
      p_display_name: parsed.data.displayName,
      p_profile_slug: generateProfileSlug(),
      p_photo_path: photoPath,
      p_public_number: generateMemberNumber(),
      p_about: parsed.data.about ?? '',
      p_links: [],
    });
    if (!error && typeof data === 'string') {
      memberId = data;
      break;
    }
    lastError = error?.message ?? lastError;
    if (error && error.code !== '23505') break;
  }

  if (!memberId) {
    console.error('[setup] complete_member_setup failed', lastError);
    return {
      error:
        lastError === 'invitation_not_found' || lastError === 'invitation_expired'
          ? 'This invitation is no longer valid. Contact GDG@PSU.'
          : 'Something went wrong creating your profile. Contact GDG@PSU.',
    };
  }

  await admin.rpc('log_audit', {
    p_actor: viewer.user.id,
    p_action: 'member.setup_completed',
    p_target_type: 'member',
    p_target_id: memberId,
    p_reason: null,
    p_before: null,
    p_after: { emailVerified: Boolean(viewer.user.email_confirmed_at) },
    p_request_id: null,
  });

  redirect('/member?welcome=1');
}
