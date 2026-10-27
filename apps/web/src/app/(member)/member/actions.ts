'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  profileUpdateSchema,
  redemptionRequestSchema,
  visibilitySchema,
  type Visibility,
} from '@gdg/contracts';
import { requireMember } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { storeProfilePhoto, PhotoError } from '@/lib/profile/photo';

export interface ActionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

const visibilityColumns: Record<keyof Visibility, string> = {
  publicProfile: 'public_profile',
  showDisplayName: 'show_display_name',
  showPhoto: 'show_photo',
  showAbout: 'show_about',
  showLinks: 'show_links',
  showMemberNumber: 'show_member_number',
  showMemberSince: 'show_member_since',
  showPoints: 'show_points',
  showStars: 'show_stars',
  showEvents: 'show_events',
  showOnLeaderboard: 'show_on_leaderboard',
  showEmail: 'show_email',
};

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
  const { member, user } = await requireMember();
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
  let photoPath = (current?.photo_path as string | undefined) ?? member.photoPath;

  const photo = formData.get('photo');
  if (photo instanceof File && photo.size > 0) {
    try {
      const nextPath = await storeProfilePhoto(photo, user.id);
      if (current?.photo_path && current.photo_path !== nextPath) {
        await admin.storage.from('avatars').remove([current.photo_path as string]).catch(() => {});
      }
      photoPath = nextPath;
    } catch (error) {
      return { error: error instanceof PhotoError ? error.message : 'Photo upload failed.' };
    }
  }

  const { error } = await admin
    .from('member_profiles')
    .update({
      display_name: parsed.data.displayName,
      about: parsed.data.about?.trim() ? parsed.data.about : null,
      links: parsed.data.links,
      photo_path: photoPath,
    })
    .eq('member_id', member.id);

  if (error) {
    console.error('[profile] update failed', error.message);
    return { error: 'Your profile could not be saved.' };
  }

  await admin.rpc('log_audit', {
    p_actor: user.id,
    p_action: 'member.profile_updated',
    p_target_type: 'member',
    p_target_id: member.id,
    p_reason: null,
    p_before: { display_name: current?.display_name, about: current?.about, links: current?.links },
    p_after: { display_name: parsed.data.displayName, about: parsed.data.about, links: parsed.data.links },
    p_request_id: null,
  });

  revalidatePath('/member/profile');
  revalidatePath('/member');
  revalidatePath(`/m/${member.slug}`);
  return { ok: true, message: 'Profile saved.' };
}

export async function updatePrivacyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { member, user } = await requireMember();
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

  revalidatePath('/member/privacy');
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
