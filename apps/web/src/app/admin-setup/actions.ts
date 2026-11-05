'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getViewer } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { storeProfilePhoto, PhotoError } from '@/lib/profile/photo';
import { generateMemberNumber, generateProfileSlug } from '@/lib/security/tokens';

const setupSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, 'Use at least 2 characters for your name')
    .max(60, 'Keep your name under 60 characters'),
  about: z.string().trim().max(280, 'Keep your bio under 280 characters').optional().default(''),
});

export interface StaffSetupState {
  error?: string;
}

/**
 * Creates a staff member's own profile, which their card will open. Runs once,
 * after they have set a password and an authenticator.
 */
export async function completeStaffSetupAction(
  _prev: StaffSetupState,
  formData: FormData,
): Promise<StaffSetupState> {
  const viewer = await getViewer();
  if (!viewer.user || !viewer.isAdmin) throw new Error('forbidden');
  const { data: assurance } = await viewer.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== 'aal2') throw new Error('forbidden');
  if (viewer.profile) redirect('/admin');

  const parsed = setupSchema.safeParse({
    displayName: formData.get('displayName'),
    about: formData.get('about') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const photo = formData.get('photo');
  if (!(photo instanceof File) || photo.size === 0) {
    return { error: 'Add a photo for your profile.' };
  }

  let photoPath: string;
  try {
    photoPath = await storeProfilePhoto(photo, viewer.user.id);
  } catch (error) {
    return { error: error instanceof PhotoError ? error.message : 'Photo upload failed.' };
  }

  const admin = createSupabaseAdmin();
  let created = false;
  let lastError = 'unknown';
  // The web address and number are random, so a clash is retried with new ones.
  for (let attempt = 0; attempt < 4 && !created; attempt += 1) {
    const { error } = await admin.rpc('complete_staff_profile', {
      p_auth_user_id: viewer.user.id,
      p_profile_slug: generateProfileSlug(),
      p_public_number: generateMemberNumber(),
      p_display_name: parsed.data.displayName,
      p_photo_path: photoPath,
      p_about: parsed.data.about ?? '',
      p_show_email: formData.get('showEmail') === 'on',
    });
    if (!error) {
      created = true;
      break;
    }
    lastError = error.message;
    if (error.code !== '23505') break;
  }

  if (!created) {
    const { error } = await admin.storage.from('avatars').remove([photoPath]);
    if (error) console.error('[staff-setup] photo cleanup failed', error.message);
    console.error('[staff-setup] complete_staff_profile failed', lastError);
    return { error: 'Your profile could not be created. Try again.' };
  }

  redirect(`/admin/profile?notice=${encodeURIComponent('Your profile is ready.')}`);
}
