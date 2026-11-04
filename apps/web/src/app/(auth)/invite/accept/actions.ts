'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { newPasswordSchema } from '@gdg/contracts';
import { requireUser } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { storeProfilePhoto, PhotoError } from '@/lib/profile/photo';
import { generateMemberNumber, generateProfileSlug } from '@/lib/security/tokens';

const setupSchema = z.object({
  displayName: z.string().trim().min(2, 'Use at least 2 characters').max(60),
  about: z.string().trim().max(280).optional().default(''),
  password: z.string().max(128).optional().default(''),
  confirmPassword: z.string().optional().default(''),
});

function passwordProblem(password: string, confirmPassword: string): string | null {
  const parsed = newPasswordSchema.safeParse(password);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Check your password.';
  if (password !== confirmPassword) return 'Passwords do not match';
  return null;
}

export interface SetupState {
  error?: string;
}

export async function completeSetupAction(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const viewer = await requireUser();
  if (viewer.member) redirect('/member');

  const email = (viewer.user.email ?? '').toLowerCase();
  const admin = createSupabaseAdmin();
  const { data: invitation } = await admin
    .from('member_invitations')
    .select('requires_password, expires_at')
    .eq('email', email)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .maybeSingle();
  // Checked before anything is stored or changed: an account without a live
  // invitation must not be able to upload files or change its password here.
  if (!invitation || new Date(invitation.expires_at as string) < new Date()) {
    return { error: 'This invitation is no longer valid. Contact GDG@PSU.' };
  }
  // Staff demoted to member already have a password. Their invitation skips
  // the password fields.
  const requiresPassword = invitation.requires_password !== false;

  const parsed = setupSchema.safeParse({
    displayName: formData.get('displayName'),
    about: formData.get('about') ?? '',
    password: formData.get('password') ?? '',
    confirmPassword: formData.get('confirmPassword') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  if (requiresPassword && !parsed.data.password) {
    return { error: 'Set a password for your account.' };
  }
  if (parsed.data.password || parsed.data.confirmPassword) {
    const problem = passwordProblem(parsed.data.password, parsed.data.confirmPassword);
    if (problem) return { error: problem };
  }

  if (formData.get('acceptTerms') !== 'on') {
    return { error: 'Please confirm the privacy and card terms.' };
  }

  if (formData.get('photoAttestation') !== 'on') {
    return { error: 'Confirm that your photo clearly shows your face.' };
  }

  const photo = formData.get('photo');
  if (!(photo instanceof File) || photo.size === 0) {
    return { error: 'Add a clear photo of your face.' };
  }

  let photoPath: string;
  try {
    photoPath = await storeProfilePhoto(photo, viewer.user.id);
  } catch (error) {
    return { error: error instanceof PhotoError ? error.message : 'Photo upload failed.' };
  }
  const discardPhoto = async () => {
    const { error } = await admin.storage.from('avatars').remove([photoPath]);
    if (error) console.error('[setup] photo cleanup failed', error.message);
  };

  if (parsed.data.password) {
    const { error: passwordError } = await viewer.supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (passwordError) {
      await discardPhoto();
      return { error: 'Your password could not be set. The invitation may have expired.' };
    }
  }

  let memberId: string | null = null;
  let lastError = 'Could not complete membership setup.';

  for (let attempt = 0; attempt < 4 && !memberId; attempt += 1) {
    const { data, error } = await admin.rpc('complete_member_setup_with_privacy', {
      p_auth_user_id: viewer.user.id,
      p_email: email,
      p_display_name: parsed.data.displayName,
      p_profile_slug: generateProfileSlug(),
      p_photo_path: photoPath,
      p_public_number: generateMemberNumber(),
      p_about: parsed.data.about ?? '',
      p_links: [],
      p_public_profile: formData.get('publicProfile') === 'on',
      p_show_email: formData.get('showEmail') === 'on',
    });
    if (!error && typeof data === 'string') {
      memberId = data;
      break;
    }
    lastError = error?.message ?? lastError;
    if (error && error.code !== '23505') break;
  }

  if (!memberId) {
    await discardPhoto();
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
