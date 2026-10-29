'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  attendanceCorrectionSchema,
  deviceCreateSchema,
  deviceUpdateSchema,
  eventInputSchema,
  interactionRewardSchema,
  invitationCreateSchema,
  memberStatusSchema,
  redemptionDecisionSchema,
  rewardInputSchema,
  scanConfirmSchema,
  cardRevokeSchema,
  cardPrepareSchema,
} from '@gdg/contracts';
import { getViewer } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import {
  encryptSecret,
  generateCardToken,
  generateDeviceSecret,
  hashToken,
} from '@/lib/security/tokens';
import { newYorkInputToIso } from '@/lib/format';
import { SITE_URL } from '@/lib/env';

async function requireAdminActor() {
  const viewer = await getViewer();
  if (!viewer.user || !viewer.isAdmin) {
    throw new Error('forbidden');
  }
  const { data: assurance } = await viewer.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== 'aal2') throw new Error('forbidden');
  return { ...viewer, user: viewer.user };
}

function fail(returnTo: string, message: string): never {
  const path = returnTo.startsWith('/admin') ? returnTo : '/admin';
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function succeed(returnTo: string, message: string, paths: string[] = []): never {
  const path = returnTo.startsWith('/admin') ? returnTo : '/admin';
  for (const target of [path, ...paths]) {
    revalidatePath(target.split('?')[0] ?? path);
  }
  redirect(`${path}?notice=${encodeURIComponent(message)}`);
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function readReturnTo(formData: FormData): string {
  const value = readString(formData, 'returnTo');
  return value.startsWith('/admin') ? value : '/admin';
}

/**
 * Builds an origin-owned confirmation link from a Supabase generated link.
 * Supabase only returns the redirect target it was willing to allowlist, so
 * relying on `action_link` breaks on custom domains; `hashed_token` lets the
 * app confirm the token itself at /auth/confirm.
 */
function confirmLink(
  properties:
    { hashed_token?: string; verification_type?: string; action_link?: string } | null | undefined,
  next: string,
): string | undefined {
  if (!properties?.hashed_token || !properties.verification_type) return properties?.action_link;
  const url = new URL('/auth/confirm', SITE_URL);
  url.searchParams.set('token_hash', properties.hashed_token);
  url.searchParams.set('type', properties.verification_type);
  url.searchParams.set('next', next);
  return url.toString();
}

function audit(
  actor: string,
  action: string,
  targetType: string,
  targetId: string | null,
  reason: string | null,
  before: unknown,
  after: unknown,
) {
  const admin = createSupabaseAdmin();
  return admin.rpc('log_audit', {
    p_actor: actor,
    p_action: action,
    p_target_type: targetType,
    p_target_id: targetId,
    p_reason: reason,
    p_before: before,
    p_after: after,
    p_request_id: null,
  });
}

/* -------------------------------------------------------------------------- */
/* Invitations                                                                */
/* -------------------------------------------------------------------------- */

export type LinkState = {
  ok?: boolean;
  error?: string;
  link?: string;
  email?: string;
};

/**
 * Email is intentionally manual: this deployment has no transactional mail
 * provider. Supabase generates a one-time link and the admin copies it into
 * their own mail client. Nothing is sent by the app.
 */
export async function createInvitationAction(
  _prev: LinkState,
  formData: FormData,
): Promise<LinkState> {
  const { user } = await requireAdminActor();
  const parsed = invitationCreateSchema.safeParse({
    email: readString(formData, 'email'),
    paidSince: readString(formData, 'paidSince'),
    note: readString(formData, 'note'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the invitation details.' };
  }

  const admin = createSupabaseAdmin();
  const { data: existing } = await admin
    .from('member_invitations')
    .select('id')
    .eq('email', parsed.data.email)
    .eq('status', 'pending')
    .maybeSingle();
  if (existing) {
    return { error: 'A pending invitation already exists for that email.' };
  }

  const { data: memberExists } = await admin
    .from('member_private')
    .select('member_id')
    .eq('email', parsed.data.email)
    .maybeSingle();
  if (memberExists) {
    return { error: 'That email already belongs to a member.' };
  }

  const redirectTo = `${SITE_URL}/auth/callback?next=/invite/accept`;
  let authUser: { id: string } | null = null;
  let link: string | undefined;
  let createdUser = false;

  const invited = await admin.auth.admin.generateLink({
    type: 'invite',
    email: parsed.data.email,
    options: { redirectTo, data: { invited_by: 'gdgpsu-admin' } },
  });

  if (!invited.error && invited.data?.user) {
    authUser = invited.data.user;
    link = confirmLink(invited.data.properties, '/invite/accept');
    createdUser = true;
  } else if (invited.error && /already|registered|exists/i.test(invited.error.message)) {
    // An Auth user from an earlier invite/revoked invitation: issue a fresh
    // password-setting link rather than failing the admin's action.
    const recovery = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: parsed.data.email,
      options: { redirectTo },
    });
    if (recovery.error || !recovery.data?.user) {
      return {
        error: `Could not create a sign-in link: ${recovery.error?.message ?? 'unknown error'}`,
      };
    }
    authUser = recovery.data.user;
    link = confirmLink(recovery.data.properties, '/invite/accept');
  } else {
    return {
      error: `Could not create the invitation: ${invited.error?.message ?? 'unknown error'}`,
    };
  }

  if (!authUser || !link) {
    return { error: 'Supabase did not return an invitation link.' };
  }

  const { data: invitation, error } = await admin
    .from('member_invitations')
    .insert({
      email: parsed.data.email,
      paid_since: parsed.data.paidSince,
      note: parsed.data.note?.trim() ? parsed.data.note.trim() : null,
      auth_user_id: authUser.id,
      created_by: user.id,
    })
    .select('id')
    .single();

  if (error || !invitation) {
    if (createdUser) await admin.auth.admin.deleteUser(authUser.id).catch(() => {});
    return { error: 'The invitation could not be recorded. Nothing was changed.' };
  }

  await audit(user.id, 'invitation.created', 'member_invitation', invitation.id, null, null, {
    email: parsed.data.email,
    paid_since: parsed.data.paidSince,
    delivery: 'manual',
  });
  revalidatePath('/admin/invitations');
  return { ok: true, email: parsed.data.email, link };
}

/**
 * Grants the admin role to an email and returns a one-time password-setting
 * link. No email is sent; the acting admin delivers the link manually. The
 * invitee still has to enroll TOTP before /admin opens (AAL2 is enforced).
 */
export async function inviteAdministratorAction(
  _prev: LinkState,
  formData: FormData,
): Promise<LinkState> {
  const { user } = await requireAdminActor();
  const parsed = z.email().safeParse(readString(formData, 'email').trim().toLowerCase());
  if (!parsed.success) return { error: 'Enter a valid email address.' };
  const email = parsed.data;

  const admin = createSupabaseAdmin();
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  let createdUserId: string | null = created.data?.user?.id ?? null;
  if (created.error && !/already|registered|exists/i.test(created.error.message)) {
    return {
      error: `Could not create the administrator: ${created.error.message}`,
    };
  }

  const recovery = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${SITE_URL}/auth/callback?next=/admin-mfa` },
  });
  const link = confirmLink(recovery.data?.properties, '/account/password');
  const authUserId = recovery.data?.user?.id ?? createdUserId;
  if (recovery.error || !link || !authUserId) {
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId).catch(() => {});
    createdUserId = null;
    return {
      error: `Could not generate an admin link: ${recovery.error?.message ?? 'unknown error'}`,
    };
  }

  const { error: roleError } = await admin.from('user_roles').upsert(
    {
      auth_user_id: authUserId,
      role: 'admin',
      granted_by: user.id,
      granted_at: new Date().toISOString(),
      revoked_at: null,
      revoked_by: null,
      note: 'Invited from the admin panel',
    },
    { onConflict: 'auth_user_id,role' },
  );
  if (roleError) {
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId).catch(() => {});
    return { error: 'The administrator role could not be granted. Nothing was changed.' };
  }

  await audit(user.id, 'admin.invited', 'user', authUserId, null, null, {
    email,
    role: 'admin',
    delivery: 'manual',
  });
  revalidatePath('/admin/invitations');
  return { ok: true, email, link };
}

export async function regenerateInvitationLinkAction(
  _prev: LinkState,
  formData: FormData,
): Promise<LinkState> {
  const { user } = await requireAdminActor();
  const invitationId = z.uuid().safeParse(formData.get('invitationId'));
  if (!invitationId.success) return { error: 'Invalid invitation.' };

  const admin = createSupabaseAdmin();
  const { data: invitation } = await admin
    .from('member_invitations')
    .select('id, email, status')
    .eq('id', invitationId.data)
    .maybeSingle();
  if (!invitation) return { error: 'Invitation not found.' };
  if (invitation.status !== 'pending') {
    return { error: 'Only pending invitations can get a new link.' };
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: invitation.email,
    options: { redirectTo: `${SITE_URL}/auth/callback?next=/invite/accept` },
  });
  const link = confirmLink(data?.properties, '/invite/accept');
  if (error || !link) {
    return { error: `Could not generate a link: ${error?.message ?? 'unknown error'}` };
  }

  const expiresAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
  await admin.from('member_invitations').update({ expires_at: expiresAt }).eq('id', invitation.id);
  await audit(
    user.id,
    'invitation.link_regenerated',
    'member_invitation',
    invitation.id,
    null,
    null,
    {
      expires_at: expiresAt,
    },
  );
  revalidatePath('/admin/invitations');
  return { ok: true, email: invitation.email, link };
}

export async function revokeInvitationAction(formData: FormData) {
  const { user } = await requireAdminActor();
  const returnTo = readReturnTo(formData);
  const invitationId = z.uuid().safeParse(formData.get('invitationId'));
  if (!invitationId.success) fail(returnTo, 'Invalid invitation.');

  const admin = createSupabaseAdmin();
  const { data: invitation } = await admin
    .from('member_invitations')
    .select('id, status')
    .eq('id', invitationId.data)
    .maybeSingle();
  if (!invitation) fail(returnTo, 'Invitation not found.');
  if (invitation.status !== 'pending') fail(returnTo, 'Only pending invitations can be revoked.');

  await admin.from('member_invitations').update({ status: 'revoked' }).eq('id', invitation.id);
  await audit(
    user.id,
    'invitation.revoked',
    'member_invitation',
    invitation.id,
    null,
    { status: 'pending' },
    { status: 'revoked' },
  );
  succeed(returnTo, 'Invitation revoked.');
}

/* -------------------------------------------------------------------------- */
/* Members                                                                    */
/* -------------------------------------------------------------------------- */

export async function setMemberStatusAction(formData: FormData) {
  const { user } = await requireAdminActor();
  const returnTo = readReturnTo(formData);
  const parsed = memberStatusSchema.safeParse({
    memberId: formData.get('memberId'),
    status: formData.get('status'),
    reason: readString(formData, 'reason'),
  });
  if (!parsed.success)
    fail(returnTo, parsed.error.issues[0]?.message ?? 'Invalid member status change.');

  const admin = createSupabaseAdmin();
  const { data: current } = await admin
    .from('members')
    .select('id, status')
    .eq('id', parsed.data.memberId)
    .maybeSingle();
  if (!current) fail(returnTo, 'Member not found.');

  const { error } = await admin
    .from('members')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.memberId);
  if (error) fail(returnTo, 'Status change failed.');

  await audit(
    user.id,
    'member.status_changed',
    'member',
    parsed.data.memberId,
    parsed.data.reason,
    { status: current.status },
    { status: parsed.data.status },
  );
  succeed(returnTo, 'Member status updated.', ['/member']);
}

export async function adjustMemberPointsAction(formData: FormData) {
  const { user } = await requireAdminActor();
  const returnTo = readReturnTo(formData);
  const parsed = interactionRewardSchema.safeParse({
    memberId: formData.get('memberId'),
    points: Number(formData.get('points')),
    reason: readString(formData, 'reason'),
  });
  if (!parsed.success) fail(returnTo, parsed.error.issues[0]?.message ?? 'Invalid point award.');

  const admin = createSupabaseAdmin();
  const { error } = await admin.rpc('grant_points', {
    p_member_id: parsed.data.memberId,
    p_points: parsed.data.points,
    p_kind: 'interaction_reward',
    p_source_key: `interaction:${randomUUID()}`,
    p_description: parsed.data.reason,
    p_actor: user.id,
    p_event_id: null,
    p_session_id: null,
    p_rule_snapshot: { source: 'admin_interaction' },
  });
  if (error) fail(returnTo, `Award failed: ${error.message}`);

  await audit(
    user.id,
    'points.interaction_awarded',
    'member',
    parsed.data.memberId,
    parsed.data.reason,
    null,
    {
      points: parsed.data.points,
      stars: parsed.data.points,
    },
  );
  succeed(returnTo, `Awarded ${parsed.data.points} points and stars.`, ['/member']);
}

export async function sendRecoveryAction(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const { user } = await requireAdminActor();
  const email = z.email().safeParse(readString(formData, 'email'));
  if (!email.success) return { error: 'Invalid email.' };

  const admin = createSupabaseAdmin();
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: email.data,
    options: { redirectTo: `${SITE_URL}/auth/callback?next=/invite/accept` },
  });
  const link = confirmLink(data?.properties, '/account/password');

  await audit(user.id, 'member.recovery_link_generated', 'member_email', email.data, null, null, {
    delivery: 'manual',
  });
  if (error || !link) {
    return { error: `Could not generate a recovery link: ${error?.message ?? 'unknown error'}` };
  }
  return { ok: true, email: email.data, link };
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

export async function prepareCardAction(formData: FormData) {
  const { user } = await requireAdminActor();
  const returnTo = readReturnTo(formData);
  const parsed = cardPrepareSchema.safeParse({
    memberId: formData.get('memberId'),
    deviceId: formData.get('deviceId'),
    reason: readString(formData, 'reason'),
  });
  if (!parsed.success) fail(returnTo, parsed.error.issues[0]?.message ?? 'Invalid card request.');

  const admin = createSupabaseAdmin();
  const { data: member } = await admin
    .from('members')
    .select('id, status, member_profiles(profile_slug)')
    .eq('id', parsed.data.memberId)
    .maybeSingle();
  const profile = Array.isArray(member?.member_profiles)
    ? member?.member_profiles[0]
    : member?.member_profiles;
  if (!member || member.status !== 'active' || !profile?.profile_slug) {
    fail(returnTo, 'That member is not active or has no profile.');
  }

  const token = generateCardToken();
  const cardUrl = `${SITE_URL}/c/${token}`;

  const { data: cardId, error: cardError } = await admin.rpc('prepare_card', {
    p_member_id: member.id,
    p_token_hash: hashToken(token),
    p_token_ciphertext: encryptSecret(token),
    p_actor: user.id,
  });
  if (cardError) fail(returnTo, `Card preparation failed: ${cardError.message}`);

  const { error: jobError } = await admin.rpc('queue_write_job', {
    p_card_id: cardId,
    p_device_uuid: parsed.data.deviceId,
    p_payload_ciphertext: encryptSecret(cardUrl),
    p_nonce: randomUUID(),
    p_ttl_seconds: 600,
    p_actor: user.id,
  });

  if (jobError) {
    await admin.rpc('revoke_card', {
      p_card_id: cardId,
      p_actor: user.id,
      p_reason: 'Write job could not be queued',
    });
    fail(returnTo, `Write job failed: ${jobError.message}`);
  }

  await audit(user.id, 'card.prepared', 'member', member.id, parsed.data.reason ?? null, null, {
    card_id: cardId,
    device_id: parsed.data.deviceId,
  });
  succeed(returnTo, 'Card queued for the writer. Token is never shown here.');
}

export async function revokeCardAction(formData: FormData) {
  const { user } = await requireAdminActor();
  const returnTo = readReturnTo(formData);
  const parsed = cardRevokeSchema.safeParse({
    cardId: formData.get('cardId'),
    reason: readString(formData, 'reason'),
  });
  if (!parsed.success) fail(returnTo, parsed.error.issues[0]?.message ?? 'Invalid revoke request.');

  const admin = createSupabaseAdmin();
  const { data: card } = await admin
    .from('card_credentials')
    .select('id, member_id, status')
    .eq('id', parsed.data.cardId)
    .maybeSingle();
  if (!card) fail(returnTo, 'Card not found.');

  const { error } = await admin.rpc('revoke_card', {
    p_card_id: parsed.data.cardId,
    p_actor: user.id,
    p_reason: parsed.data.reason,
  });
  if (error) fail(returnTo, error.message);

  await audit(
    user.id,
    'card.revoked',
    'member',
    card.member_id,
    parsed.data.reason,
    { status: card.status },
    { status: 'lost' },
  );
  succeed(returnTo, 'Card revoked. The member profile URL is unchanged.', ['/member']);
}

export async function completeWriteJobAction(formData: FormData) {
  const { user } = await requireAdminActor();
  const returnTo = readReturnTo(formData);
  const jobId = z.uuid().safeParse(formData.get('jobId'));
  if (!jobId.success) fail(returnTo, 'Invalid job.');
  const admin = createSupabaseAdmin();
  const { data: job } = await admin
    .from('card_write_jobs')
    .select('id, device_id')
    .eq('id', jobId.data)
    .maybeSingle();
  if (!job) fail(returnTo, 'Job not found.');
  const { error } = await admin.rpc('complete_write_job', {
    p_job_id: jobId.data,
    p_device_uuid: job.device_id,
    p_status: 'failed',
    p_read_back_matches: false,
    p_failure_code: 'admin_cancelled',
    p_ndef_length: null,
    p_actor: user.id,
  });
  if (error) fail(returnTo, error.message);
  await audit(user.id, 'card.write_cancelled', 'card_write_job', jobId.data, null, null, null);
  succeed(returnTo, 'Write job cancelled.');
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

function readSession(formData: FormData, prefix: string, kind: 'main' | 'bonus') {
  return {
    id: readString(formData, `${prefix}Id`) || undefined,
    name: readString(formData, `${prefix}Name`),
    kind,
    startsAt: readString(formData, `${prefix}StartsAt`),
    endsAt: readString(formData, `${prefix}EndsAt`),
    checkInOpensAt: readString(formData, `${prefix}CheckInOpensAt`),
    checkInClosesAt: readString(formData, `${prefix}CheckInClosesAt`),
    checkOutOpensAt: readString(formData, `${prefix}CheckOutOpensAt`),
    checkOutClosesAt: readString(formData, `${prefix}CheckOutClosesAt`),
    minimumDurationMinutes: Number(readString(formData, `${prefix}MinDuration`)),
    rewardPoints: Number(readString(formData, `${prefix}Reward`)),
    isEnabled: true,
  };
}

function toIso(value: string): string {
  try {
    return newYorkInputToIso(value);
  } catch {
    return value;
  }
}

function normalizeSession(session: ReturnType<typeof readSession>) {
  return {
    ...session,
    startsAt: toIso(session.startsAt),
    endsAt: toIso(session.endsAt),
    checkInOpensAt: toIso(session.checkInOpensAt),
    checkInClosesAt: toIso(session.checkInClosesAt),
    checkOutOpensAt: toIso(session.checkOutOpensAt),
    checkOutClosesAt: toIso(session.checkOutClosesAt),
  };
}

export async function saveEventAction(formData: FormData) {
  const { user } = await requireAdminActor();
  const returnTo = readReturnTo(formData);
  const eventId = readString(formData, 'eventId') || undefined;
  const sessions = [normalizeSession(readSession(formData, 'main', 'main'))];
  if (readString(formData, 'bonusName')) {
    const bonus = normalizeSession(readSession(formData, 'bonus', 'bonus'));
    sessions.push(bonus);
  }

  const parsed = eventInputSchema.safeParse({
    name: readString(formData, 'name'),
    slug: readString(formData, 'slug'),
    summary: readString(formData, 'summary'),
    location: readString(formData, 'location'),
    startsAt: toIso(readString(formData, 'startsAt')),
    endsAt: toIso(readString(formData, 'endsAt')),
    status: readString(formData, 'status'),
    isPublic: formData.get('isPublic') === 'on',
    sessions,
  });
  if (!parsed.success) {
    fail(returnTo, parsed.error.issues[0]?.message ?? 'Check the event form.');
  }

  const admin = createSupabaseAdmin();
  let id = eventId;
  if (id) {
    const { error } = await admin
      .from('events')
      .update({
        name: parsed.data.name,
        slug: parsed.data.slug,
        summary: parsed.data.summary,
        location: parsed.data.location,
        starts_at: parsed.data.startsAt,
        ends_at: parsed.data.endsAt,
        status: parsed.data.status,
        is_public: parsed.data.isPublic,
      })
      .eq('id', id);
    if (error) fail(returnTo, `Event update failed: ${error.message}`);
  } else {
    const { data, error } = await admin
      .from('events')
      .insert({
        name: parsed.data.name,
        slug: parsed.data.slug,
        summary: parsed.data.summary,
        location: parsed.data.location,
        starts_at: parsed.data.startsAt,
        ends_at: parsed.data.endsAt,
        status: parsed.data.status,
        is_public: parsed.data.isPublic,
        created_by: user.id,
      })
      .select('id')
      .single();
    if (error || !data) fail(returnTo, `Event creation failed: ${error?.message ?? 'unknown'}`);
    id = data.id;
  }

  for (const session of parsed.data.sessions) {
    const payload = {
      event_id: id,
      name: session.name,
      kind: session.kind,
      starts_at: session.startsAt,
      ends_at: session.endsAt,
      check_in_opens_at: session.checkInOpensAt,
      check_in_closes_at: session.checkInClosesAt,
      check_out_opens_at: session.checkOutOpensAt,
      check_out_closes_at: session.checkOutClosesAt,
      minimum_duration_minutes: session.minimumDurationMinutes,
      reward_points: session.rewardPoints,
      is_enabled: session.isEnabled,
      reward_policy: {
        minimum_duration_minutes: session.minimumDurationMinutes,
        reward_points: session.rewardPoints,
      },
    };
    if (session.id) {
      const { error } = await admin.from('event_sessions').update(payload).eq('id', session.id);
      if (error) fail(returnTo, `Session update failed: ${error.message}`);
    } else {
      const { data: existing } = await admin
        .from('event_sessions')
        .select('id')
        .eq('event_id', id)
        .eq('kind', session.kind)
        .maybeSingle();
      if (existing) {
        const { error } = await admin.from('event_sessions').update(payload).eq('id', existing.id);
        if (error) fail(returnTo, `Session update failed: ${error.message}`);
      } else {
        const { error } = await admin.from('event_sessions').insert(payload);
        if (error) fail(returnTo, `Session creation failed: ${error.message}`);
      }
    }
  }

  await audit(
    user.id,
    eventId ? 'event.updated' : 'event.created',
    'event',
    id ?? null,
    null,
    null,
    {
      name: parsed.data.name,
      status: parsed.data.status,
      sessions: parsed.data.sessions.length,
    },
  );
  succeed(returnTo, 'Event saved.', [
    '/events',
    `/events/${parsed.data.slug}`,
    `/admin/events/${id}`,
  ]);
}

export async function setEventStatusAction(formData: FormData) {
  const { user } = await requireAdminActor();
  const returnTo = readReturnTo(formData);
  const eventId = z.uuid().safeParse(formData.get('eventId'));
  const status = z
    .enum(['draft', 'published', 'cancelled', 'completed'])
    .safeParse(formData.get('status'));
  if (!eventId.success || !status.success) fail(returnTo, 'Invalid status change.');

  const admin = createSupabaseAdmin();
  const { data: event } = await admin
    .from('events')
    .select('id, slug, status')
    .eq('id', eventId.data)
    .maybeSingle();
  if (!event) fail(returnTo, 'Event not found.');
  const { error } = await admin
    .from('events')
    .update({ status: status.data })
    .eq('id', eventId.data);
  if (error) fail(returnTo, error.message);
  await audit(
    user.id,
    'event.status_changed',
    'event',
    event.id,
    null,
    { status: event.status },
    { status: status.data },
  );
  succeed(returnTo, `Event marked ${status.data}.`, ['/events', `/events/${event.slug}`]);
}

/* -------------------------------------------------------------------------- */
/* Kiosk                                                                      */
/* -------------------------------------------------------------------------- */

export async function confirmScanAction(formData: FormData) {
  const { user } = await requireAdminActor();
  const returnTo = readReturnTo(formData);
  const parsed = scanConfirmSchema.safeParse({
    scanId: formData.get('scanId'),
    action: formData.get('action'),
    reason: readString(formData, 'reason') || undefined,
  });
  if (!parsed.success) fail(returnTo, 'Invalid scan confirmation.');

  const admin = createSupabaseAdmin();
  const { error } = await admin.rpc('confirm_scan', {
    p_scan_id: parsed.data.scanId,
    p_action: parsed.data.action,
    p_actor: user.id,
    p_reason: parsed.data.reason ?? null,
    p_request_id: null,
  });
  if (error) fail(returnTo, error.message);
  succeed(
    returnTo,
    parsed.data.action === 'check_in'
      ? 'Check-in confirmed.'
      : parsed.data.action === 'check_out'
        ? 'Check-out confirmed.'
        : 'Scan rejected.',
    ['/member', '/admin'],
  );
}

export async function correctAttendanceAction(formData: FormData) {
  const { user } = await requireAdminActor();
  const returnTo = readReturnTo(formData);
  const checkedOutRaw = readString(formData, 'checkedOutAt');
  const parsed = attendanceCorrectionSchema.safeParse({
    attendanceId: formData.get('attendanceId'),
    action: formData.get('action'),
    checkedOutAt: checkedOutRaw ? toIso(checkedOutRaw) : undefined,
    reason: readString(formData, 'reason'),
  });
  if (!parsed.success) fail(returnTo, parsed.error.issues[0]?.message ?? 'Invalid correction.');

  const admin = createSupabaseAdmin();
  const { error } = await admin.rpc('correct_attendance', {
    p_attendance_id: parsed.data.attendanceId,
    p_action: parsed.data.action,
    p_checked_out_at: parsed.data.checkedOutAt ?? null,
    p_reason: parsed.data.reason,
    p_actor: user.id,
  });
  if (error) fail(returnTo, error.message);
  succeed(returnTo, 'Attendance corrected and audited.', ['/member', '/admin/audit']);
}

/* -------------------------------------------------------------------------- */
/* Rewards                                                                    */
/* -------------------------------------------------------------------------- */

export async function saveRewardAction(formData: FormData) {
  const { user } = await requireAdminActor();
  const returnTo = readReturnTo(formData);
  const inventoryRaw = readString(formData, 'inventory');
  const parsed = rewardInputSchema.safeParse({
    id: readString(formData, 'rewardId') || undefined,
    name: readString(formData, 'name'),
    description: readString(formData, 'description'),
    costPoints: Number(readString(formData, 'costPoints')),
    inventory: inventoryRaw === '' ? null : Number(inventoryRaw),
    isActive: formData.get('isActive') === 'on',
    fulfillmentNote: readString(formData, 'fulfillmentNote'),
  });
  if (!parsed.success) fail(returnTo, parsed.error.issues[0]?.message ?? 'Check the reward form.');

  const admin = createSupabaseAdmin();
  const payload = {
    name: parsed.data.name,
    description: parsed.data.description,
    cost_points: parsed.data.costPoints,
    inventory: parsed.data.inventory,
    is_active: parsed.data.isActive,
    fulfillment_note: parsed.data.fulfillmentNote,
  };
  const { error } = parsed.data.id
    ? await admin.from('rewards').update(payload).eq('id', parsed.data.id)
    : await admin.from('rewards').insert({ ...payload, created_by: user.id });
  if (error) fail(returnTo, `Reward save failed: ${error.message}`);
  await audit(
    user.id,
    parsed.data.id ? 'reward.updated' : 'reward.created',
    'reward',
    parsed.data.id ?? parsed.data.name,
    null,
    null,
    payload,
  );
  succeed(returnTo, 'Reward saved.', ['/member/rewards']);
}

export async function decideRedemptionAction(formData: FormData) {
  const { user } = await requireAdminActor();
  const returnTo = readReturnTo(formData);
  const parsed = redemptionDecisionSchema.safeParse({
    redemptionId: formData.get('redemptionId'),
    action: formData.get('action'),
    reason: readString(formData, 'reason') || undefined,
  });
  if (!parsed.success) fail(returnTo, 'Invalid redemption action.');

  const admin = createSupabaseAdmin();
  const { data: current } = await admin
    .from('redemptions')
    .select('id, status, member_id')
    .eq('id', parsed.data.redemptionId)
    .maybeSingle();
  if (!current) fail(returnTo, 'Redemption not found.');

  const { error } = await admin.rpc('decide_redemption', {
    p_redemption_id: parsed.data.redemptionId,
    p_action: parsed.data.action,
    p_actor: user.id,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) fail(returnTo, error.message);
  await audit(
    user.id,
    `redemption.${parsed.data.action}`,
    'redemption',
    parsed.data.redemptionId,
    parsed.data.reason ?? null,
    { status: current.status },
    { status: parsed.data.action },
  );
  succeed(returnTo, `Redemption ${parsed.data.action}.`, ['/member/rewards']);
}

/* -------------------------------------------------------------------------- */
/* Devices                                                                    */
/* -------------------------------------------------------------------------- */

export interface DeviceFormState {
  error?: string;
  secret?: string;
  deviceId?: string;
}

export async function createDeviceAction(
  _prev: DeviceFormState,
  formData: FormData,
): Promise<DeviceFormState> {
  const { user } = await requireAdminActor();
  const parsed = deviceCreateSchema.safeParse({
    deviceId: readString(formData, 'deviceId'),
    laneLabel: readString(formData, 'laneLabel'),
    mode: readString(formData, 'mode') || 'kiosk',
    eventId: readString(formData, 'eventId') || null,
    sessionId: readString(formData, 'sessionId') || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the device details.' };
  }

  const secret = generateDeviceSecret();
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('devices')
    .insert({
      device_id: parsed.data.deviceId,
      lane_label: parsed.data.laneLabel,
      secret_hash: hashToken(secret),
      secret_ciphertext: encryptSecret(secret),
      mode: parsed.data.mode,
      event_id: parsed.data.eventId || null,
      session_id: parsed.data.sessionId || null,
      created_by: user.id,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { error: `Device creation failed: ${error?.message ?? 'unknown'}` };
  }

  await audit(user.id, 'device.created', 'device', data.id, null, null, {
    device_id: parsed.data.deviceId,
    mode: parsed.data.mode,
  });
  revalidatePath('/admin/devices');
  return { secret, deviceId: parsed.data.deviceId };
}

export async function updateDeviceAction(
  _prev: DeviceFormState,
  formData: FormData,
): Promise<DeviceFormState> {
  const { user } = await requireAdminActor();
  const parsed = deviceUpdateSchema.safeParse({
    deviceId: formData.get('deviceUuid'),
    laneLabel: readString(formData, 'laneLabel') || undefined,
    mode: (readString(formData, 'mode') || undefined) as 'kiosk' | 'writer' | undefined,
    eventId: readString(formData, 'eventId') || null,
    sessionId: readString(formData, 'sessionId') || null,
    enabled: formData.get('enabled') === 'on',
    rotateSecret: formData.get('rotateSecret') === 'on',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the device details.' };
  }

  const admin = createSupabaseAdmin();
  const { data: device } = await admin
    .from('devices')
    .select('id, device_id, status')
    .eq('id', parsed.data.deviceId)
    .maybeSingle();
  if (!device) return { error: 'Device not found.' };

  const update: Record<string, unknown> = {
    event_id: parsed.data.eventId || null,
    session_id: parsed.data.sessionId || null,
  };
  if (parsed.data.laneLabel !== undefined) update.lane_label = parsed.data.laneLabel;
  if (parsed.data.mode !== undefined) update.mode = parsed.data.mode;
  if (parsed.data.enabled !== undefined) {
    update.status = parsed.data.enabled ? 'active' : 'disabled';
  }
  let secret: string | undefined;
  if (parsed.data.rotateSecret) {
    secret = generateDeviceSecret();
    update.secret_hash = hashToken(secret);
    update.secret_ciphertext = encryptSecret(secret);
    update.rotated_at = new Date().toISOString();
  }

  const { error } = await admin.from('devices').update(update).eq('id', parsed.data.deviceId);
  if (error) return { error: `Update failed: ${error.message}` };

  await audit(
    user.id,
    'device.updated',
    'device',
    parsed.data.deviceId,
    null,
    { status: device.status },
    {
      mode: parsed.data.mode,
      enabled: parsed.data.enabled,
      rotated: Boolean(parsed.data.rotateSecret),
    },
  );
  revalidatePath('/admin/devices');
  return { secret, deviceId: device.device_id };
}
