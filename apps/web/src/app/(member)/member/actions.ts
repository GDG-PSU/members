'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  profileUpdateSchema,
  redemptionRequestSchema,
  visibilitySchema,
  type Visibility,
} from '@gdg/contracts';
import { requireMember, requireProfile } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { storeProfilePhoto, PhotoError } from '@/lib/profile/photo';
import { VISIBILITY_COLUMNS as visibilityColumns } from '@/lib/profile/visibility';

export interface ActionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

function humanize(message: string): string {
  const map: Record<string, string> = {
    insufficient_points: 'You do not have enough points for that yet.',
    out_of_stock: 'That reward just went out of stock.',
    reward_unavailable: 'That reward is no longer available.',
    invalid_transition: 'That request has already been handled.',
    redemption_not_found: 'That request could not be found.',
  };
  return map[message] ?? 'Something went wrong. Try again.';
}

export async function updateProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile: own, user } = await requireProfile();
  const member = { id: own.memberId, slug: own.slug, photoPath: own.photoPath };
  const admin = createSupabaseAdmin();

  let links: unknown = [];
  try {
    links = JSON.parse(String(formData.get('links') ?? '[]'));
  } catch {
    return { error: 'Links could not be read. Remove and re-add them.' };
  }

  const parsed = profileUpdateSchema.safeParse({
    displayName: formData.get('displayName'),
    about: String(formData.get('about') ?? ''),
    links,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the profile form.' };
  }

  const { data: current } = await admin
    .from('member_profiles')
    .select('photo_path, display_name, about, links')
    .eq('member_id', member.id)
    .maybeSingle();
  const previousPhotoPath = (current?.photo_path as string | null | undefined) ?? member.photoPath;
  const photo = formData.get('photo');
  const hasNewPhoto = photo instanceof File && photo.size > 0;
  // The kiosk checks a member against their photo. An organizer is never checked
  // in, so theirs can wait.
  if (!previousPhotoPath && !hasNewPhoto && own.kind === 'member') {
    return { error: 'Add a clear photo of your face before saving.' };
  }

  let newPhotoPath: string | null = null;
  if (photo instanceof File && photo.size > 0) {
    try {
      newPhotoPath = await storeProfilePhoto(photo, user.id);
    } catch (error) {
      return { error: error instanceof PhotoError ? error.message : 'Photo upload failed.' };
    }
  }

  const about = parsed.data.about?.trim() ? parsed.data.about : null;
  const { error } = await admin
    .from('member_profiles')
    .update({
      display_name: parsed.data.displayName,
      about,
      links: parsed.data.links,
      photo_path: newPhotoPath ?? previousPhotoPath,
    })
    .eq('member_id', member.id);

  // Only one photo may survive, and the profile must never point at a missing one.
  const obsoletePhoto = error ? newPhotoPath : newPhotoPath ? previousPhotoPath : null;
  if (obsoletePhoto) {
    const { error: removeError } = await admin.storage.from('avatars').remove([obsoletePhoto]);
    if (removeError) console.error('[profile] photo cleanup failed', removeError.message);
  }

  if (error) {
    console.error('[profile] update failed', error.message);
    return { error: 'Your profile could not be saved.' };
  }

  // Field names only: audit rows outlive account erasure, so they must not keep
  // a member's bio and links.
  const changedFields = [
    parsed.data.displayName !== current?.display_name && 'display_name',
    about !== (current?.about ?? null) && 'about',
    JSON.stringify(parsed.data.links) !== JSON.stringify(current?.links ?? []) && 'links',
    newPhotoPath !== null && 'photo',
  ].filter(Boolean);

  await admin.rpc('log_audit', {
    p_actor: user.id,
    p_action: 'member.profile_updated',
    p_target_type: 'member',
    p_target_id: member.id,
    p_reason: null,
    p_before: null,
    p_after: { changed: changedFields },
    p_request_id: null,
  });

  revalidatePath('/member/profile');
  revalidatePath('/member');
  revalidatePath('/admin/profile');
  revalidatePath(`/m/${member.slug}`);
  return { ok: true, message: 'Profile saved.' };
}

export async function updatePrivacyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile: own, user } = await requireProfile();
  const member = { id: own.memberId, slug: own.slug };
  const admin = createSupabaseAdmin();

  const input = Object.fromEntries(
    (Object.keys(visibilityColumns) as (keyof Visibility)[]).map((key) => [
      key,
      formData.get(key) === 'on',
    ]),
  );
  const parsed = visibilitySchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'Could not read the privacy settings.' };
  }

  const { data: current } = await admin
    .from('member_profiles')
    .select(Object.values(visibilityColumns).join(', '))
    .eq('member_id', member.id)
    .maybeSingle();

  const update = Object.fromEntries(
    (Object.keys(visibilityColumns) as (keyof Visibility)[]).map((key) => [
      visibilityColumns[key],
      parsed.data[key],
    ]),
  );

  const { error } = await admin.from('member_profiles').update(update).eq('member_id', member.id);
  if (error) {
    console.error('[privacy] update failed', error.message);
    return { error: 'Privacy settings could not be saved.' };
  }

  await admin.rpc('log_audit', {
    p_actor: user.id,
    p_action: 'member.privacy_updated',
    p_target_type: 'member',
    p_target_id: member.id,
    p_reason: null,
    p_before: current ?? null,
    p_after: update,
    p_request_id: null,
  });

  revalidatePath('/member/profile');
  revalidatePath('/admin/profile');
  revalidatePath('/member');
  revalidatePath('/leaderboard');
  revalidatePath(`/m/${member.slug}`);
  return { ok: true, message: 'Privacy settings saved.' };
}

export async function requestRedemptionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { member, user } = await requireMember();
  const parsed = redemptionRequestSchema.safeParse({
    rewardId: formData.get('rewardId'),
    quantity: Number(formData.get('quantity') ?? 1),
    idempotencyKey: formData.get('idempotencyKey'),
  });
  if (!parsed.success) {
    return { error: 'That request was not valid. Reload and try again.' };
  }

  const admin = createSupabaseAdmin();
  const { data, error } = await admin.rpc('redeem_reward', {
    p_member_id: member.id,
    p_reward_id: parsed.data.rewardId,
    p_quantity: parsed.data.quantity,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { error: humanize(error.message) };
  }

  await admin.rpc('log_audit', {
    p_actor: user.id,
    p_action: 'redemption.requested',
    p_target_type: 'redemption',
    p_target_id: String(data),
    p_reason: null,
    p_before: null,
    p_after: { reward_id: parsed.data.rewardId, quantity: parsed.data.quantity },
    p_request_id: null,
  });

  revalidatePath('/member/rewards');
  revalidatePath('/member');
  return { ok: true, message: 'Requested. An organizer will follow up.' };
}

export async function cancelRedemptionAction(formData: FormData): Promise<void> {
  const { member, user } = await requireMember();
  const redemptionId = z.uuid().safeParse(formData.get('redemptionId'));
  if (!redemptionId.success) return;

  const admin = createSupabaseAdmin();
  const { data: redemption } = await admin
    .from('redemptions')
    .select('id, member_id, status')
    .eq('id', redemptionId.data)
    .maybeSingle();

  if (!redemption || redemption.member_id !== member.id) return;
  if (!['requested', 'approved'].includes(redemption.status as string)) return;

  const { error } = await admin.rpc('decide_redemption', {
    p_redemption_id: redemptionId.data,
    p_action: 'cancel',
    p_actor: user.id,
    p_reason: 'Cancelled by member',
  });

  if (!error) {
    await admin.rpc('log_audit', {
      p_actor: user.id,
      p_action: 'redemption.cancelled_by_member',
      p_target_type: 'redemption',
      p_target_id: redemptionId.data,
      p_reason: 'Cancelled by member',
      p_before: { status: redemption.status },
      p_after: { status: 'cancelled' },
      p_request_id: null,
    });
  }

  revalidatePath('/member/rewards');
  revalidatePath('/member');
}
