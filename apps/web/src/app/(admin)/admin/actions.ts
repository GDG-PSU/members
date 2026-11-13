'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  attendanceCorrectionSchema,
  eventFormSchema,
  interactionRewardSchema,
  invitationCreateSchema,
  memberStatusSchema,
  redemptionDecisionSchema,
  rewardInputSchema,
  cardRevokeSchema,
} from '@gdg/contracts';
import { getViewer } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { photoChangedWithin } from '@/lib/profile/identity';
import { profilePhotoUrl } from '@/lib/profile/photo';
import { encryptSecret, generateCardToken, hashToken } from '@/lib/security/tokens';
import {
  DEFAULT_ARRIVE_BY,
  DEFAULT_LEAVE_FROM,
  KEEP_TIMES,
  sessionWindows,
  slugifyEventName,
  type ArriveBy,
  type LeaveFrom,
} from '@/lib/events/attendance-rules';
import { newYorkInputToIso } from '@/lib/format';
import { SITE_URL } from '@/lib/env';
import { issueSignInLink } from '@/lib/auth/sign-in-links';
import { loadReaderKey, retireReaderKeys, storeReaderKey } from '@/lib/reader/key-store';
import { newReaderKey, readerKeyCheck, readerSessionSecrets } from '@/lib/reader/keys';
import { READER_DEVICE_ID, READER_NONCE, fromBase64Url } from '@/lib/reader/protocol';
import { withinRateLimit } from '@/lib/security/rate-limit';

async function requireAdminActor() {
  const viewer = await getViewer();
  if (!viewer.user || !viewer.isAdmin) {
    throw new Error('forbidden');
  }
  const { data: assurance } = await viewer.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== 'aal2') throw new Error('forbidden');
  return { ...viewer, user: viewer.user };
}

/** For the actions behind /admin/members/[id], which is a superadmin-only page. */
async function requireSuperadminActor() {
  const viewer = await requireAdminActor();
  if (!viewer.isSuperadmin) throw new Error('forbidden');
  return viewer;
}

const DOMAIN_ERRORS: Record<string, string> = {
  already_qualified: 'This attendance is already qualified.',
  card_not_activatable: 'This card can no longer be activated. Prepare a new one.',
  card_not_revocable: 'That card is no longer active.',
  checkout_before_check_in: 'Check-out must be after check-in.',
  checkout_required_before_qualifying: 'Set a check-out time before qualifying this attendance.',
  checkout_time_required: 'Enter a check-out time.',
  insufficient_balance_for_reversal:
    'The member has already spent these points, so the award cannot be reversed.',
  invalid_transition: 'That request has already been handled.',
  reason_required: 'Enter a reason for this action.',
};

/** Domain errors are stable codes; anything else may expose database details. */
function domainErrorMessage(message: string): string {
  const known = DOMAIN_ERRORS[message];
  if (known) return known;
  console.error('[admin-action]', message);
  return 'That change could not be saved. Try again.';
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

async function audit(
  actor: string,
  action: string,
  targetType: string,
  targetId: string | null,
  reason: string | null,
  before: unknown,
  after: unknown,
) {
  const admin = createSupabaseAdmin();
  const { error } = await admin.rpc('log_audit', {
    p_actor: actor,
    p_action: action,
    p_target_type: targetType,
    p_target_id: targetId,
    p_reason: reason,
    p_before: before,
    p_after: after,
    p_request_id: null,
  });
  // The change has already happened, so a missed entry must at least be visible.
  if (error) console.error(`[audit] ${action} was not recorded: ${error.message}`);
}

/* -------------------------------------------------------------------------- */
/* Permanent delete                                                           */
/* -------------------------------------------------------------------------- */

const DELETE_ERRORS: Record<string, string> = {
  not_found: 'That has already been deleted.',
  auth_user_not_found: 'That account has already been deleted.',
  superadmin_required: 'Only superadmins can delete things for good.',
  reward_has_open_requests: 'Decide the requests still waiting for this reward, then delete it.',
  redemption_still_open: 'Decide this request before deleting it.',
  attendance_has_points:
    'This attendance gave points. Disqualify it first so the points are taken back, then delete it.',
  invitation_in_use: 'That invitation was accepted. Delete the member instead.',
  cannot_delete_self: 'You cannot delete your own account.',
};

const DELETED: Record<string, string> = {
  event: 'Event deleted for good.',
  reward: 'Reward deleted for good.',
  redemption: 'Request deleted for good.',
  card: 'Card deleted for good.',
  attendance: 'Attendance record deleted for good.',
  invitation: 'Invitation deleted for good.',
  user: 'Account deleted for good.',
};

/**
 * Superadmin-only. The database function checks the actor again, deletes, and
 * writes the audit entry in one transaction; the audit log itself has no delete.
 * `failTo` is where an error is shown, because after a successful delete the
 * page the button was on no longer exists.
 */
export async function deleteRecordAction(formData: FormData) {
  const { user } = await requireSuperadminActor();
  const returnTo = readReturnTo(formData);
  const failValue = readString(formData, 'failTo');
  const failTo = failValue.startsWith('/admin') ? failValue : returnTo;
  const parsed = z
    .object({
      kind: z.enum(['event', 'reward', 'redemption', 'card', 'attendance', 'invitation', 'user']),
      id: z.uuid(),
    })
    .safeParse({ kind: formData.get('kind'), id: formData.get('id') });
  if (!parsed.success) fail(failTo, 'That could not be deleted.');

  const admin = createSupabaseAdmin();
  const { error } = await admin.rpc('delete_record', {
    p_kind: parsed.data.kind,
    p_id: parsed.data.id,
    p_actor: user.id,
  });
  if (error) {
    const code = Object.keys(DELETE_ERRORS).find((key) => error.message.includes(key));
    if (!code) console.error('[delete]', parsed.data.kind, error.message);
    fail(failTo, code ? (DELETE_ERRORS[code] ?? '') : 'That could not be deleted. Try again.');
  }

  if (parsed.data.kind === 'user') {
    // Photos live in storage, which the database function cannot reach.
    const folder = `member/${parsed.data.id}`;
    const { data: files } = await admin.storage.from('avatars').list(folder, { limit: 100 });
    const paths = (files ?? []).map((file) => `${folder}/${file.name}`);
    if (paths.length > 0) {
      const { error: removeError } = await admin.storage.from('avatars').remove(paths);
      if (removeError) console.error('[delete] photo cleanup failed', removeError.message);
    }
  }

  succeed(returnTo, DELETED[parsed.data.kind] ?? 'Deleted for good.', [
    '/admin',
    '/admin/users',
    '/admin/events',
    '/admin/rewards',
    '/admin/cards',
    '/events',
    '/leaderboard',
    '/member',
    '/member/rewards',
  ]);
}

/* -------------------------------------------------------------------------- */
/* Invitations                                                                */
/* -------------------------------------------------------------------------- */

export type LinkState = {
  ok?: boolean;
  error?: string;
  link?: string;
  email?: string;
  role?: 'admin' | 'superadmin';
  /** How long the link works, for the person copying it. */
  hours?: number;
};

/**
 * Email is intentionally manual: this deployment has no transactional mail
 * provider. The app makes a one-time link and the admin copies it into their
 * own mail client. Nothing is sent by the app. The Supabase calls below only
 * create or find the account; the token they return is not used.
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
  // Setup refuses an expired invitation but cannot record that from the
  // transaction it aborts, so the row stays pending and would block a new invite.
  await admin
    .from('member_invitations')
    .update({ status: 'expired' })
    .eq('email', parsed.data.email)
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString());

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
    .select('member_id, members(kind)')
    .eq('email', parsed.data.email)
    .maybeSingle();
  if (memberExists) {
    const owner = Array.isArray(memberExists.members)
      ? memberExists.members[0]
      : memberExists.members;
    return {
      error:
        owner?.kind === 'organizer'
          ? 'That email already has staff access. Change their user type from Users instead.'
          : 'That email already belongs to a member.',
    };
  }

  const redirectTo = `${SITE_URL}/auth/callback?next=/invite/accept`;
  let authUser: { id: string } | null = null;
  let createdUser = false;

  const invited = await admin.auth.admin.generateLink({
    type: 'invite',
    email: parsed.data.email,
    options: { redirectTo, data: { invited_by: 'gdgpsu-admin' } },
  });

  if (!invited.error && invited.data?.user) {
    authUser = invited.data.user;
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
  } else {
    return {
      error: `Could not create the invitation: ${invited.error?.message ?? 'unknown error'}`,
    };
  }

  if (!authUser) {
    return { error: 'The account for this invitation could not be created.' };
  }

  const { data: activeStaffRoles } = await admin
    .from('user_roles')
    .select('role')
    .eq('auth_user_id', authUser.id)
    .in('role', ['admin', 'superadmin'])
    .is('revoked_at', null);
  if (activeStaffRoles?.length) {
    if (createdUser) await admin.auth.admin.deleteUser(authUser.id).catch(() => {});
    return {
      error: 'That email already has staff access. Change their user type from Users instead.',
    };
  }

  const { data: invitation, error } = await admin
    .from('member_invitations')
    .insert({
      email: parsed.data.email,
      paid_since: parsed.data.paidSince,
      note: parsed.data.note?.trim() ? parsed.data.note.trim() : null,
      auth_user_id: authUser.id,
      created_by: user.id,
      requires_password: true,
    })
    .select('id')
    .single();

  if (error || !invitation) {
    if (createdUser) await admin.auth.admin.deleteUser(authUser.id).catch(() => {});
    return { error: 'The invitation could not be recorded. Nothing was changed.' };
  }

  const issued = await issueSignInLink({
    purpose: 'member_invite',
    authUserId: authUser.id,
    createdBy: user.id,
  });
  if (!issued) {
    await admin.from('member_invitations').delete().eq('id', invitation.id);
    if (createdUser) await admin.auth.admin.deleteUser(authUser.id).catch(() => {});
    return { error: 'The invitation link could not be made. Nothing was changed.' };
  }
  // The invitation is open exactly as long as its link works.
  await admin
    .from('member_invitations')
    .update({ expires_at: issued.expiresAt })
    .eq('id', invitation.id);

  await audit(user.id, 'invitation.created', 'member_invitation', invitation.id, null, null, {
    email: parsed.data.email,
    paid_since: parsed.data.paidSince,
    delivery: 'manual',
  });
  revalidatePath('/admin/invitations');
  revalidatePath('/admin/users');
  return { ok: true, email: parsed.data.email, link: issued.link, hours: issued.hours };
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
  const viewer = await requireAdminActor();
  const { user } = viewer;
  if (!viewer.isSuperadmin) {
    return { error: 'Only superadmins can invite administrators.' };
  }
  const parsed = z.email().safeParse(readString(formData, 'email').trim().toLowerCase());
  if (!parsed.success) return { error: 'Enter a valid email address.' };
  const parsedRole = z
    .enum(['admin', 'superadmin'])
    .safeParse(readString(formData, 'role') || 'admin');
  if (!parsedRole.success) return { error: 'Choose a valid staff role.' };
  const role = parsedRole.data;
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
  const authUserId = recovery.data?.user?.id ?? createdUserId;
  if (recovery.error || !authUserId) {
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId).catch(() => {});
    createdUserId = null;
    return {
      error: `Could not generate an admin link: ${recovery.error?.message ?? 'unknown error'}`,
    };
  }

  const [{ data: existingRoles }, { data: existingMember }] = await Promise.all([
    admin
      .from('user_roles')
      .select('role')
      .eq('auth_user_id', authUserId)
      .in('role', ['admin', 'superadmin'])
      .is('revoked_at', null),
    admin
      .from('members')
      .select('id')
      .eq('auth_user_id', authUserId)
      .eq('kind', 'member')
      .maybeSingle(),
  ]);
  if (existingMember) {
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId).catch(() => {});
    return { error: 'That email is already a member. Change their user type from Users instead.' };
  }
  if (role === 'admin' && existingRoles?.some((existing) => existing.role === 'superadmin')) {
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId).catch(() => {});
    return { error: 'That email already has superadmin access.' };
  }

  const { error: roleError } = await admin.from('user_roles').upsert(
    {
      auth_user_id: authUserId,
      role,
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

  if (role === 'superadmin') {
    const { error: revokeError } = await admin
      .from('user_roles')
      .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
      .eq('auth_user_id', authUserId)
      .eq('role', 'admin')
      .is('revoked_at', null);
    if (revokeError) {
      console.error(`[admin-invite] could not revoke the old admin role: ${revokeError.message}`);
    }
  }

  await admin
    .from('member_invitations')
    .update({ status: 'revoked' })
    .eq('email', email)
    .eq('status', 'pending');

  // Staff whose access was revoked keep an archived profile; inviting them
  // again brings it back, card included.
  await admin
    .from('members')
    .update({ status: 'active' })
    .eq('auth_user_id', authUserId)
    .eq('kind', 'organizer');

  await audit(user.id, 'admin.invited', 'user', authUserId, null, null, {
    email,
    role,
    delivery: 'manual',
  });
  revalidatePath('/admin/invitations');
  revalidatePath('/admin/users');

  const issued = await issueSignInLink({
    purpose: 'staff_invite',
    authUserId,
    createdBy: user.id,
  });
  if (!issued) {
    return { error: 'Their access is set up, but the link could not be made. Invite them again.' };
  }
  return { ok: true, email, link: issued.link, role, hours: issued.hours };
}

/**
 * Changes a user's exclusive type. Superadmin-only. The database function is
 * transactional: member data is deleted before a staff role is granted, and a
 * staff demotion revokes roles before creating the member invitation.
 */
export async function changeUserRoleAction(formData: FormData) {
  const viewer = await requireAdminActor();
  const { user } = viewer;
  const returnTo = readReturnTo(formData);
  if (!viewer.isSuperadmin) fail(returnTo, 'Only superadmins can change user types.');

  const authUserId = z.uuid().safeParse(formData.get('authUserId'));
  const role = z.enum(['member', 'admin', 'superadmin']).safeParse(formData.get('role'));
  if (!authUserId.success || !role.success) fail(returnTo, 'Invalid user type change.');
  if (authUserId.data === user.id) fail(returnTo, 'You cannot change your own user type.');

  const admin = createSupabaseAdmin();
  const [{ data: beforeRoles }, { data: beforeMember }] = await Promise.all([
    admin
      .from('user_roles')
      .select('role')
      .eq('auth_user_id', authUserId.data)
      .in('role', ['admin', 'superadmin'])
      .is('revoked_at', null),
    admin
      .from('members')
      .select('id, status, kind')
      .eq('auth_user_id', authUserId.data)
      .maybeSingle(),
  ]);
  const currentType = beforeRoles?.some((row) => row.role === 'superadmin')
    ? 'superadmin'
    : beforeRoles?.length
      ? 'admin'
      : beforeMember?.kind === 'member'
        ? 'member'
        : null;
  if (currentType === role.data) fail(returnTo, 'That is already their user type.');

  const { data, error } = await admin.rpc('set_user_type', {
    p_auth_user_id: authUserId.data,
    p_role: role.data,
    p_actor: user.id,
    p_paid_since: null,
  });
  if (error) {
    if (error.message.includes('last_superadmin')) {
      fail(returnTo, 'The last active superadmin cannot be demoted.');
    }
    if (error.message.includes('auth_user_not_found')) fail(returnTo, 'User not found.');
    fail(returnTo, `User type change failed: ${error.message}`);
  }

  const result = (data ?? {}) as {
    role?: string;
    history_removed?: boolean;
    profile_removed?: boolean;
    invitation_id?: string | null;
  };
  const label =
    role.data === 'superadmin' ? 'superadmin' : role.data === 'admin' ? 'admin' : 'member';
  const message =
    role.data === 'member'
      ? result.invitation_id
        ? 'Changed to member. They can finish member setup on their next sign-in.'
        : 'Changed to member.'
      : result.history_removed
        ? `Changed to ${label}. Their profile and card were kept; their points and attendance history were removed.`
        : `Changed to ${label}.`;

  await audit(
    user.id,
    'user.type_changed',
    'user',
    authUserId.data,
    null,
    {
      roles: (beforeRoles ?? []).map((row) => row.role),
      member_id: beforeMember?.id ?? null,
      member_status: beforeMember?.status ?? null,
    },
    {
      role: role.data,
      history_removed: Boolean(result.history_removed),
      profile_removed: Boolean(result.profile_removed),
      invitation_id: result.invitation_id ?? null,
    },
  );
  succeed(returnTo, message, ['/admin', '/admin/invitations', '/admin/users']);
}

/** Revokes member access, staff access, or both. Staff access is superadmin-only. */
export async function revokeUserAccessAction(formData: FormData) {
  const viewer = await requireAdminActor();
  const { user } = viewer;
  const returnTo = readReturnTo(formData);
  const authUserId = z.uuid().safeParse(formData.get('authUserId'));
  if (!authUserId.success) fail(returnTo, 'Invalid user.');
  if (authUserId.data === user.id) fail(returnTo, 'You cannot revoke your own access.');

  const admin = createSupabaseAdmin();
  const [{ data: roles }, { data: member }] = await Promise.all([
    admin
      .from('user_roles')
      .select('role')
      .eq('auth_user_id', authUserId.data)
      .in('role', ['admin', 'superadmin'])
      .is('revoked_at', null),
    admin
      .from('members')
      .select('id, status, kind')
      .eq('auth_user_id', authUserId.data)
      .maybeSingle(),
  ]);
  // An organizer's row is their staff profile and card, so it goes with their
  // staff access and is not a membership of its own.
  const isMember = member?.kind === 'member';

  if (!roles?.length && (!member || (!isMember && member.status === 'archived'))) {
    fail(returnTo, 'That user has no active access.');
  }
  if (roles?.length && !viewer.isSuperadmin) {
    fail(returnTo, 'Only superadmins can revoke staff access.');
  }
  if (member && member.status === 'archived' && !roles?.length) {
    fail(returnTo, 'That member is already archived.');
  }

  // Staff roles first: if the last-superadmin guard refuses, the profile and card
  // must not have been switched off already.
  if (roles?.length) {
    const { error } = await admin
      .from('user_roles')
      .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
      .eq('auth_user_id', authUserId.data)
      .in('role', ['admin', 'superadmin'])
      .is('revoked_at', null);
    if (error) {
      fail(
        returnTo,
        error.message.includes('last_superadmin')
          ? 'The last active superadmin cannot be revoked.'
          : 'Staff access could not be revoked.',
      );
    }
  }
  if (member) {
    const { error } = await admin
      .from('members')
      .update({ status: 'archived' })
      .eq('id', member.id);
    if (error) fail(returnTo, 'Member access could not be revoked.');
  }

  await audit(
    user.id,
    'user.access_revoked',
    'user',
    authUserId.data,
    null,
    {
      roles: (roles ?? []).map((row) => row.role),
      member_id: member?.id ?? null,
      member_status: member?.status ?? null,
    },
    {
      roles: [],
      member_status: member ? 'archived' : null,
    },
  );
  succeed(
    returnTo,
    isMember && roles?.length
      ? 'Member and organizer access removed.'
      : isMember
        ? 'Member access removed.'
        : 'Organizer access removed.',
    ['/admin', '/admin/users', '/member'],
  );
}

export async function regenerateInvitationLinkAction(
  _prev: LinkState,
  formData: FormData,
): Promise<LinkState> {
  const viewer = await requireAdminActor();
  const { user } = viewer;
  const invitationId = z.uuid().safeParse(formData.get('invitationId'));
  if (!invitationId.success) return { error: 'Invalid invitation.' };

  const admin = createSupabaseAdmin();
  const { data: invitation } = await admin
    .from('member_invitations')
    .select('id, email, status, created_by, auth_user_id')
    .eq('id', invitationId.data)
    .maybeSingle();
  if (!invitation) return { error: 'Invitation not found.' };
  if (!viewer.isSuperadmin && invitation.created_by !== user.id) {
    return { error: 'You can only regenerate invitations you created.' };
  }
  if (invitation.status !== 'pending') {
    return { error: 'Only pending invitations can get a new link.' };
  }
  if (!invitation.auth_user_id) {
    return { error: 'This invitation has no account. Cancel it and invite them again.' };
  }

  // A new link reopens an invitation that was not accepted in time.
  const issued = await issueSignInLink({
    purpose: 'member_invite',
    authUserId: invitation.auth_user_id as string,
    createdBy: user.id,
  });
  if (!issued) return { error: 'A new link could not be made. Try again.' };

  const expiresAt = issued.expiresAt;
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
  revalidatePath('/admin/users');
  return { ok: true, email: invitation.email, link: issued.link, hours: issued.hours };
}

export async function revokeInvitationAction(formData: FormData) {
  const viewer = await requireAdminActor();
  const { user } = viewer;
  const returnTo = readReturnTo(formData);
  const invitationId = z.uuid().safeParse(formData.get('invitationId'));
  if (!invitationId.success) fail(returnTo, 'Invalid invitation.');

  const admin = createSupabaseAdmin();
  const { data: invitation } = await admin
    .from('member_invitations')
    .select('id, status, created_by, auth_user_id')
    .eq('id', invitationId.data)
    .maybeSingle();
  if (!invitation) fail(returnTo, 'Invitation not found.');
  if (!viewer.isSuperadmin && invitation.created_by !== user.id) {
    fail(returnTo, 'You can only revoke invitations you created.');
  }
  if (invitation.status !== 'pending') fail(returnTo, 'Only pending invitations can be revoked.');

  await admin.from('member_invitations').update({ status: 'revoked' }).eq('id', invitation.id);
  // The link would otherwise still sign the person in, to a page that turns them away.
  if (invitation.auth_user_id) {
    await admin
      .from('sign_in_links')
      .delete()
      .eq('auth_user_id', invitation.auth_user_id)
      .eq('purpose', 'member_invite');
  }
  await audit(
    user.id,
    'invitation.revoked',
    'member_invitation',
    invitation.id,
    null,
    { status: 'pending' },
    { status: 'revoked' },
  );
  succeed(returnTo, 'Invitation cancelled.', ['/admin/invitations', '/admin/users']);
}

/* -------------------------------------------------------------------------- */
/* Members                                                                    */
/* -------------------------------------------------------------------------- */

export async function setMemberStatusAction(formData: FormData) {
  const { user } = await requireSuperadminActor();
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
  const { user } = await requireSuperadminActor();
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
  if (error) fail(returnTo, domainErrorMessage(error.message));

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

/**
 * A recovery link is a password reset for whoever holds it, and this accepts any
 * email. In a normal admin's hands it would take over a member, or a staff
 * account that has not enrolled TOTP yet, which includes new superadmins.
 */
export async function sendRecoveryAction(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const { user } = await requireSuperadminActor();
  const email = z.email().safeParse(readString(formData, 'email').trim().toLowerCase());
  if (!email.success) return { error: 'Invalid email.' };

  const admin = createSupabaseAdmin();
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: email.data,
    options: { redirectTo: `${SITE_URL}/auth/callback?next=/account/password` },
  });
  // Only used to find the account; the link people get is the app's own.
  if (error || !data.user) {
    return { error: `Could not make a password reset link: ${error?.message ?? 'unknown error'}` };
  }
  const issued = await issueSignInLink({
    purpose: 'recovery',
    authUserId: data.user.id,
    createdBy: user.id,
  });
  if (!issued) return { error: 'The password reset link could not be made. Try again.' };

  await audit(user.id, 'member.recovery_link_generated', 'user', data.user.id, null, null, {
    delivery: 'manual',
  });
  return { ok: true, email: email.data, link: issued.link, hours: issued.hours };
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

export type UsbCardState = {
  ok?: boolean;
  error?: string;
  cardId?: string;
  cardUrl?: string;
  memberLabel?: string;
  activated?: boolean;
};

export type KioskMethod = 'card' | 'qr' | 'manual';

export type UsbKioskPreview = {
  ok?: boolean;
  error?: string;
  scanId?: string;
  memberName?: string;
  memberNumber?: string;
  photoUrl?: string | null;
  photoChangedAt?: string | null;
  photoChangedRecently?: boolean;
  eventName?: string;
  sessionName?: string;
  action?: 'check_in' | 'check_out';
  method?: KioskMethod;
};

export type KioskMemberHit = {
  memberId: string;
  name: string;
  number: string;
  photoUrl: string | null;
};

function cardTokenFromUri(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const match = /^\/c\/([A-Za-z0-9_-]{20,100})\/?$/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The QR code on a member's digital ID is their profile link. */
function profileSlugFromCode(code: string): string | null {
  try {
    const match = /^\/m\/([A-Za-z0-9_-]{22,64})\/?$/.exec(new URL(code).pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Every way of identifying a member at the kiosk ends here: a short-lived
 * pending scan that an organizer still has to confirm. No attendance is written.
 */
async function startKioskScan(input: {
  memberId: string;
  cardId: string | null;
  sessionId: string;
  method: KioskMethod;
  actorId: string;
}): Promise<UsbKioskPreview> {
  const admin = createSupabaseAdmin();
  const { data: member } = await admin
    .from('members')
    .select(
      'id, kind, status, public_number, member_profiles(display_name, profile_slug, photo_changed_at)',
    )
    .eq('id', input.memberId)
    .maybeSingle();
  const profile = Array.isArray(member?.member_profiles)
    ? member.member_profiles[0]
    : member?.member_profiles;
  if (!member || member.status !== 'active') {
    return { error: 'That member is not active.' };
  }
  if (member.kind !== 'member') {
    return { error: 'That is an organizer. Organizers are not checked in to events.' };
  }

  const { data: session } = await admin
    .from('event_sessions')
    .select(
      'id, name, kind, check_in_opens_at, check_in_closes_at, check_out_opens_at, check_out_closes_at, is_enabled, events(name, status)',
    )
    .eq('id', input.sessionId)
    .maybeSingle();
  const event = Array.isArray(session?.events) ? session.events[0] : session?.events;
  if (!session || !session.is_enabled || event?.status === 'cancelled') {
    return { error: 'That event session is not available.' };
  }

  const now = Date.now();
  const opens = new Date(session.check_in_opens_at as string).getTime();
  const closes = new Date(session.check_in_closes_at as string).getTime();
  const checkOutOpens = new Date(session.check_out_opens_at as string).getTime();
  const checkOutCloses = new Date(session.check_out_closes_at as string).getTime();

  const { data: attendance } = await admin
    .from('attendance_records')
    .select('id, state, checked_in_at, checked_out_at')
    .eq('member_id', member.id)
    .eq('session_id', session.id)
    .maybeSingle();

  let action: 'check_in' | 'check_out';
  if (!attendance) {
    if (now < opens || now > closes) {
      return { error: 'Check-in is not open for that session.' };
    }
    action = 'check_in';
  } else if (attendance.state === 'checked_in') {
    if (now < checkOutOpens || now > checkOutCloses) {
      return { error: 'Check-out is not open for that session.' };
    }
    action = 'check_out';
  } else {
    return { error: 'This member already has a completed attendance record for that session.' };
  }

  const { data: scan, error: scanError } = await admin
    .from('device_scans')
    .insert({
      device_id: null,
      member_id: member.id,
      card_id: input.cardId,
      session_id: session.id,
      action,
      status: 'pending',
      idempotency_key: `kiosk:${randomUUID()}`,
      expires_at: new Date(now + 3 * 60_000).toISOString(),
      metadata: { source: 'usb-kiosk', method: input.method, actor: input.actorId },
    })
    .select('id')
    .single();
  if (scanError || !scan) {
    console.error(`[kiosk] could not create pending scan: ${scanError?.message ?? 'unknown'}`);
    return { error: 'The kiosk could not start this check-in. Try again.' };
  }

  const photoChangedAt = (profile?.photo_changed_at as string | undefined) ?? null;
  return {
    ok: true,
    scanId: scan.id as string,
    memberName: (profile?.display_name as string | null) ?? 'Member',
    memberNumber: member.public_number as string,
    photoUrl: profilePhotoUrl((profile?.profile_slug as string | null) ?? null),
    photoChangedAt,
    photoChangedRecently: photoChangedWithin(photoChangedAt),
    eventName: (event?.name as string | null) ?? 'Event',
    sessionName: session.name as string,
    action,
    method: input.method,
  };
}

/**
 * Resolves a card URL read over the browser-local USB reader. It deliberately
 * does not require a registered device: the admin's authenticated session and
 * the existing confirmation transaction remain the authority.
 */
export async function previewUsbKioskAction(input: {
  uri: string;
  sessionId: string;
}): Promise<UsbKioskPreview> {
  const { user } = await requireAdminActor();
  const parsed = z
    .object({
      uri: z.string().trim().min(1).max(2048),
      sessionId: z.uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: 'Scan a valid card and select an event session.' };

  const token = cardTokenFromUri(parsed.data.uri);
  if (!token) return { error: 'That tag does not contain a valid GDG card URL.' };

  const { data: card } = await createSupabaseAdmin()
    .from('card_credentials')
    .select('id, member_id, status')
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (!card || card.status !== 'active') {
    return { error: 'That card is not active. Use a current member card or issue a replacement.' };
  }

  return startKioskScan({
    memberId: card.member_id as string,
    cardId: card.id as string,
    sessionId: parsed.data.sessionId,
    method: 'card',
    actorId: user.id,
  });
}

/**
 * Starts a check-in without a card: the organizer picked the member from a
 * search, or scanned the QR code on their digital ID. Neither proves who is
 * standing there any more than a card does, so the same photo check and
 * confirmation follow, and the attendance row records the method.
 */
export async function previewKioskLookupAction(input: {
  sessionId: string;
  memberId?: string;
  code?: string;
}): Promise<UsbKioskPreview> {
  const { user } = await requireAdminActor();
  const parsed = z
    .object({
      sessionId: z.uuid(),
      memberId: z.uuid().optional(),
      code: z.string().trim().min(1).max(2048).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: 'Choose a member and an event session.' };
  const { sessionId, memberId, code } = parsed.data;

  if (memberId) {
    return startKioskScan({
      memberId,
      cardId: null,
      sessionId,
      method: 'manual',
      actorId: user.id,
    });
  }
  if (!code) return { error: 'Choose a member and an event session.' };

  const admin = createSupabaseAdmin();
  const slug = profileSlugFromCode(code);
  if (slug) {
    const { data: profile } = await admin
      .from('member_profiles')
      .select('member_id')
      .eq('profile_slug', slug)
      .maybeSingle();
    if (!profile) return { error: 'That code does not belong to a member.' };
    return startKioskScan({
      memberId: profile.member_id as string,
      cardId: null,
      sessionId,
      method: 'qr',
      actorId: user.id,
    });
  }

  const number = code.toUpperCase();
  if (/^GDG-[A-Z0-9]{6}$/.test(number)) {
    const { data: member } = await admin
      .from('members')
      .select('id')
      .eq('public_number', number)
      .maybeSingle();
    if (!member) return { error: 'No member has that GDG number.' };
    return startKioskScan({
      memberId: member.id as string,
      cardId: null,
      sessionId,
      method: 'manual',
      actorId: user.id,
    });
  }

  return { error: 'That is not a member QR code or GDG number.' };
}

/** Finds active members by name or GDG number for a check-in without a card. */
export async function searchKioskMembersAction(query: string): Promise<KioskMemberHit[]> {
  await requireAdminActor();
  const parsed = z.string().trim().min(2).max(60).safeParse(query);
  if (!parsed.success) return [];
  // The value goes into a LIKE pattern, where % and _ are wildcards.
  const pattern = `%${parsed.data.replace(/[\\%_]/g, '\\$&')}%`;

  const admin = createSupabaseAdmin();
  const [byName, byNumber] = await Promise.all([
    admin
      .from('member_profiles')
      .select('display_name, profile_slug, members!inner(id, status, public_number)')
      .ilike('display_name', pattern)
      .eq('members.status', 'active')
      .eq('members.kind', 'member')
      .order('display_name')
      .limit(8),
    admin
      .from('members')
      .select('id, public_number, member_profiles!inner(display_name, profile_slug)')
      .ilike('public_number', pattern)
      .eq('status', 'active')
      .eq('kind', 'member')
      .order('public_number')
      .limit(8),
  ]);

  const hits = new Map<string, KioskMemberHit>();
  for (const row of byName.data ?? []) {
    const member = Array.isArray(row.members) ? row.members[0] : row.members;
    if (!member) continue;
    hits.set(member.id as string, {
      memberId: member.id as string,
      name: row.display_name as string,
      number: member.public_number as string,
      photoUrl: profilePhotoUrl(row.profile_slug as string),
    });
  }
  for (const row of byNumber.data ?? []) {
    const profile = Array.isArray(row.member_profiles)
      ? row.member_profiles[0]
      : row.member_profiles;
    if (!profile || hits.has(row.id as string)) continue;
    hits.set(row.id as string, {
      memberId: row.id as string,
      name: profile.display_name as string,
      number: row.public_number as string,
      photoUrl: profilePhotoUrl(profile.profile_slug as string),
    });
  }
  return [...hits.values()].slice(0, 8);
}

export type CardHolder = {
  memberId: string;
  name: string;
  /** A member's GDG number, or "Organizer". */
  detail: string;
  photoUrl: string | null;
  hasActiveCard: boolean;
};

type CardHolderRow = {
  id: string;
  kind: string;
  public_number: string;
  profile: { display_name: string; profile_slug: string; photo_path: string | null };
};

async function toCardHolders(rows: CardHolderRow[]): Promise<CardHolder[]> {
  if (rows.length === 0) return [];
  const { data: active } = await createSupabaseAdmin()
    .from('card_credentials')
    .select('member_id')
    .eq('status', 'active')
    .in(
      'member_id',
      rows.map((row) => row.id),
    );
  const withCard = new Set((active ?? []).map((card) => card.member_id as string));
  return rows.map((row) => ({
    memberId: row.id,
    name: row.profile.display_name,
    detail: row.kind === 'organizer' ? 'Organizer' : row.public_number,
    photoUrl: row.profile.photo_path ? profilePhotoUrl(row.profile.profile_slug) : null,
    hasActiveCard: withCard.has(row.id),
  }));
}

const CARD_HOLDER_COLUMNS =
  'id, kind, status, public_number, member_profiles!inner(display_name, profile_slug, photo_path)';

function cardHolderRow(row: {
  id: unknown;
  kind: unknown;
  public_number: unknown;
  member_profiles: unknown;
}): CardHolderRow | null {
  const profile = Array.isArray(row.member_profiles) ? row.member_profiles[0] : row.member_profiles;
  if (!profile) return null;
  return {
    id: row.id as string,
    kind: row.kind as string,
    public_number: row.public_number as string,
    profile: profile as CardHolderRow['profile'],
  };
}

/** Finds the active members and organizers a card can be written for. */
export async function searchCardHoldersAction(query: string): Promise<CardHolder[]> {
  await requireAdminActor();
  const parsed = z.string().trim().min(2).max(60).safeParse(query);
  if (!parsed.success) return [];
  // The value goes into a LIKE pattern, where % and _ are wildcards.
  const pattern = `%${parsed.data.replace(/[\\%_]/g, '\\$&')}%`;

  const admin = createSupabaseAdmin();
  const [byName, byNumber] = await Promise.all([
    admin
      .from('members')
      .select(CARD_HOLDER_COLUMNS)
      .eq('status', 'active')
      .ilike('member_profiles.display_name', pattern)
      .limit(8),
    admin
      .from('members')
      .select(CARD_HOLDER_COLUMNS)
      .eq('status', 'active')
      .eq('kind', 'member')
      .ilike('public_number', pattern)
      .limit(8),
  ]);

  const rows = new Map<string, CardHolderRow>();
  for (const row of [...(byName.data ?? []), ...(byNumber.data ?? [])]) {
    const holder = cardHolderRow(row);
    if (holder && !rows.has(holder.id)) rows.set(holder.id, holder);
  }
  const holders = await toCardHolders([...rows.values()].slice(0, 8));
  return holders.sort((a, b) => a.name.localeCompare(b.name));
}

/** The person a card page was opened for, when a link names one. */
export async function findCardHolderAction(memberId: string): Promise<CardHolder | null> {
  await requireAdminActor();
  if (!z.uuid().safeParse(memberId).success) return null;
  const { data } = await createSupabaseAdmin()
    .from('members')
    .select(CARD_HOLDER_COLUMNS)
    .eq('id', memberId)
    .eq('status', 'active')
    .maybeSingle();
  const holder = data ? cardHolderRow(data) : null;
  return holder ? ((await toCardHolders([holder]))[0] ?? null) : null;
}

/**
 * Prepares a pending card for the local Web Serial writer. Unlike the legacy
 * writer-job path, this returns the one-time card URL to the authenticated
 * admin so it can be written from /admin/cards; the card is activated only after
 * the browser has verified the write/read-back.
 */
export async function prepareUsbCardAction(
  _prev: UsbCardState,
  formData: FormData,
): Promise<UsbCardState> {
  const { user } = await requireAdminActor();
  const memberId = z.uuid().safeParse(formData.get('memberId'));
  if (!memberId.success) return { error: 'Select an active member.' };
  const reason = readString(formData, 'reason').trim();
  if (reason.length > 200) return { error: 'Keep the reason to 200 characters.' };

  const admin = createSupabaseAdmin();
  const { data: member } = await admin
    .from('members')
    .select('id, status, member_profiles(display_name, profile_slug)')
    .eq('id', memberId.data)
    .maybeSingle();
  const profile = Array.isArray(member?.member_profiles)
    ? member.member_profiles[0]
    : member?.member_profiles;
  if (!member || member.status !== 'active' || !profile?.profile_slug) {
    return { error: 'That member is not active or has no profile.' };
  }

  const token = generateCardToken();
  const cardUrl = `${SITE_URL}/c/${token}`;
  const { data: cardId, error } = await admin.rpc('prepare_card', {
    p_member_id: member.id,
    p_token_hash: hashToken(token),
    p_token_ciphertext: encryptSecret(token),
    p_actor: user.id,
  });
  if (error || !cardId) {
    return { error: domainErrorMessage(error?.message ?? 'prepare_card returned no card') };
  }

  await audit(user.id, 'card.usb_prepared', 'member', member.id, reason || null, null, {
    card_id: cardId,
  });
  revalidatePath('/admin/cards');
  return {
    ok: true,
    cardId,
    cardUrl,
    memberLabel: (profile.display_name as string | null) ?? 'Member',
  };
}

export async function activateUsbCardAction(
  _prev: UsbCardState,
  formData: FormData,
): Promise<UsbCardState> {
  const { user } = await requireAdminActor();
  const cardId = z.uuid().safeParse(formData.get('cardId'));
  if (!cardId.success) return { error: 'Invalid card.' };
  if (formData.get('readBackVerified') !== 'on') {
    return { error: 'Write the URL and verify the read-back before activating.' };
  }

  const admin = createSupabaseAdmin();
  const { data: card } = await admin
    .from('card_credentials')
    .select('id, status, member_id')
    .eq('id', cardId.data)
    .maybeSingle();
  if (!card) return { error: 'Card not found.' };
  if (card.status !== 'pending') return { error: 'This card is not pending activation.' };

  const { error } = await admin.rpc('activate_card', {
    p_card_id: cardId.data,
    p_actor: user.id,
  });
  if (error) return { error: domainErrorMessage(error.message) };

  await audit(user.id, 'card.usb_activated', 'member', card.member_id, null, null, {
    card_id: cardId.data,
  });
  revalidatePath('/admin/cards');
  return { ok: true, activated: true };
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
  if (error) fail(returnTo, domainErrorMessage(error.message));

  await audit(
    user.id,
    'card.revoked',
    'member',
    card.member_id,
    parsed.data.reason,
    { status: card.status },
    { status: 'lost' },
  );
  succeed(returnTo, 'Card switched off. Their profile page is unchanged.', ['/member']);
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

function toIso(value: string): string {
  try {
    return newYorkInputToIso(value);
  } catch {
    return value;
  }
}

/** Errors come back to the form rather than through a redirect, so typed values survive. */
export type AdminFormState = { error?: string };

function eventSaveError(error: { code?: string; message: string }): AdminFormState {
  if (error.code === '23505') {
    return { error: 'Another event was just saved with the same name. Save again.' };
  }
  return { error: domainErrorMessage(error.message) };
}

type StoredSession = {
  id: string;
  kind: 'main' | 'bonus';
  name: string;
  check_in_opens_at: string;
  check_in_closes_at: string;
  check_out_opens_at: string;
  check_out_closes_at: string;
};

/** The event's public web address: its name, with a number added if that is taken. */
async function freeEventSlug(
  admin: ReturnType<typeof createSupabaseAdmin>,
  name: string,
): Promise<string> {
  const base = slugifyEventName(name) || 'event';
  const { data } = await admin.from('events').select('slug').like('slug', `${base}%`);
  const taken = new Set((data ?? []).map((row) => row.slug as string));
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 200; suffix += 1) {
    if (!taken.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

/** Times that match no option are left exactly as stored when the form says to keep them. */
function windowsFor(
  startsAt: string,
  endsAt: string,
  arriveBy: ArriveBy | typeof KEEP_TIMES,
  leaveFrom: LeaveFrom | typeof KEEP_TIMES,
  stored: StoredSession | undefined,
) {
  const computed = sessionWindows(
    startsAt,
    endsAt,
    arriveBy === KEEP_TIMES ? DEFAULT_ARRIVE_BY : arriveBy,
    leaveFrom === KEEP_TIMES ? DEFAULT_LEAVE_FROM : leaveFrom,
  );
  const keepCheckIn = arriveBy === KEEP_TIMES && stored;
  const keepCheckOut = leaveFrom === KEEP_TIMES && stored;
  return {
    check_in_opens_at: keepCheckIn ? stored.check_in_opens_at : computed.checkInOpensAt,
    check_in_closes_at: keepCheckIn ? stored.check_in_closes_at : computed.checkInClosesAt,
    check_out_opens_at: keepCheckOut ? stored.check_out_opens_at : computed.checkOutOpensAt,
    check_out_closes_at: keepCheckOut ? stored.check_out_closes_at : computed.checkOutClosesAt,
  };
}

/**
 * Saves an event from the short form. The organizer gives the event's own times,
 * the points, and two attendance rules; the session rows and their check-in and
 * check-out times are worked out here. A new event always starts as a draft.
 */
export async function saveEventAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const { user } = await requireAdminActor();
  const eventId = readString(formData, 'eventId') || undefined;
  if (eventId && !z.uuid().safeParse(eventId).success) return { error: 'Invalid event.' };

  const startsInput = readString(formData, 'startsAt');
  const endsInput = readString(formData, 'endsAt');
  if (!startsInput || !endsInput) return { error: 'Enter when the event starts and ends.' };
  const bonusName = readString(formData, 'bonusName').trim();
  const bonusStarts = readString(formData, 'bonusStartsAt');
  const bonusEnds = readString(formData, 'bonusEndsAt');
  if (bonusName && (!bonusStarts || !bonusEnds)) {
    return { error: 'Enter when the bonus session starts and ends.' };
  }

  const parsed = eventFormSchema.safeParse({
    name: readString(formData, 'name'),
    summary: readString(formData, 'summary'),
    location: readString(formData, 'location'),
    startsAt: toIso(startsInput),
    endsAt: toIso(endsInput),
    isPublic: formData.get('isPublic') === 'on',
    points: Number(readString(formData, 'points') || '0'),
    arriveBy: readString(formData, 'arriveBy') || DEFAULT_ARRIVE_BY,
    leaveFrom: readString(formData, 'leaveFrom') || DEFAULT_LEAVE_FROM,
    bonus: bonusName
      ? {
          name: bonusName,
          startsAt: toIso(bonusStarts),
          endsAt: toIso(bonusEnds),
          points: Number(readString(formData, 'bonusPoints') || '0'),
        }
      : null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the event form.' };
  }
  const form = parsed.data;

  const admin = createSupabaseAdmin();
  let existing: { id: string; slug: string } | null = null;
  let stored: StoredSession[] = [];
  if (eventId) {
    const { data } = await admin
      .from('events')
      .select(
        'id, slug, event_sessions(id, kind, name, check_in_opens_at, check_in_closes_at, check_out_opens_at, check_out_closes_at)',
      )
      .eq('id', eventId)
      .maybeSingle();
    if (!data) return { error: 'That event no longer exists.' };
    existing = { id: data.id as string, slug: data.slug as string };
    stored = (Array.isArray(data.event_sessions) ? data.event_sessions : []) as StoredSession[];
  }

  const eventRow = {
    name: form.name,
    summary: form.summary,
    location: form.location,
    starts_at: form.startsAt,
    ends_at: form.endsAt,
    is_public: form.isPublic,
  };
  let id: string;
  let slug: string;
  if (existing) {
    // The web address stays put when the name changes, so shared links keep working.
    ({ id, slug } = existing);
    const { error } = await admin.from('events').update(eventRow).eq('id', id);
    if (error) return eventSaveError(error);
  } else {
    slug = await freeEventSlug(admin, form.name);
    const { data, error } = await admin
      .from('events')
      .insert({ ...eventRow, slug, status: 'draft', created_by: user.id })
      .select('id')
      .single();
    if (error || !data) return eventSaveError(error ?? { message: 'Event insert returned no row' });
    id = data.id as string;
  }

  const saveSession = async (
    kind: 'main' | 'bonus',
    input: { name: string; startsAt: string; endsAt: string; points: number },
  ) => {
    const current = stored.find((session) => session.kind === kind);
    const payload = {
      event_id: id,
      kind,
      name: input.name,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      ...windowsFor(input.startsAt, input.endsAt, form.arriveBy, form.leaveFrom, current),
      // The arrive-by and leave-from times are the whole rule now.
      minimum_duration_minutes: 0,
      reward_points: input.points,
      is_enabled: true,
      reward_policy: { minimum_duration_minutes: 0, reward_points: input.points },
    };
    const { error } = current
      ? await admin.from('event_sessions').update(payload).eq('id', current.id).eq('event_id', id)
      : await admin.from('event_sessions').insert(payload);
    return error;
  };

  const mainError = await saveSession('main', {
    name: stored.find((session) => session.kind === 'main')?.name ?? 'Main session',
    startsAt: form.startsAt,
    endsAt: form.endsAt,
    points: form.points,
  });
  if (mainError) return eventSaveError(mainError);

  const storedBonus = stored.find((session) => session.kind === 'bonus');
  if (form.bonus) {
    const bonusError = await saveSession('bonus', form.bonus);
    if (bonusError) return eventSaveError(bonusError);
  } else if (storedBonus) {
    // A bonus session people already attended is switched off, never deleted,
    // so their attendance and points stay on record.
    const { count } = await admin
      .from('attendance_records')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', storedBonus.id);
    const { error } = count
      ? await admin.from('event_sessions').update({ is_enabled: false }).eq('id', storedBonus.id)
      : await admin.from('event_sessions').delete().eq('id', storedBonus.id);
    if (error) return eventSaveError(error);
  }

  await audit(user.id, existing ? 'event.updated' : 'event.created', 'event', id, null, null, {
    name: form.name,
    sessions: form.bonus ? 2 : 1,
  });
  succeed(
    `/admin/events/${id}`,
    existing ? 'Event saved.' : 'Event saved as a draft. Publish it when it is ready.',
    ['/events', `/events/${slug}`, '/admin/events'],
  );
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
  if (error) fail(returnTo, domainErrorMessage(error.message));
  await audit(
    user.id,
    'event.status_changed',
    'event',
    event.id,
    null,
    { status: event.status },
    { status: status.data },
  );
  const message = {
    draft: 'Event moved back to drafts.',
    published: 'Event published.',
    cancelled: 'Event cancelled.',
    completed: 'Event marked completed.',
  }[status.data];
  succeed(returnTo, message, ['/events', `/events/${event.slug}`, '/admin/events']);
}

/* -------------------------------------------------------------------------- */
/* Attendance                                                                 */
/* -------------------------------------------------------------------------- */

export async function correctAttendanceAction(formData: FormData) {
  const { user } = await requireSuperadminActor();
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
  if (error) fail(returnTo, domainErrorMessage(error.message));
  succeed(returnTo, 'Attendance corrected and audited.', ['/member', '/admin/audit']);
}

/* -------------------------------------------------------------------------- */
/* Rewards                                                                    */
/* -------------------------------------------------------------------------- */

export async function saveRewardAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
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
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the reward form.' };
  }

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
  if (error) return { error: domainErrorMessage(error.message) };
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
  if (error) fail(returnTo, domainErrorMessage(error.message));
  await audit(
    user.id,
    `redemption.${parsed.data.action}`,
    'redemption',
    parsed.data.redemptionId,
    parsed.data.reason ?? null,
    { status: current.status },
    { status: parsed.data.action },
  );
  const message = {
    approve: 'Request approved.',
    fulfil: 'Marked as handed over.',
    reject: 'Request rejected and the points refunded.',
    cancel: 'Request cancelled and the points refunded.',
  }[parsed.data.action];
  succeed(returnTo, message, ['/member/rewards']);
}

/* -------------------------------------------------------------------------- */
/* Card readers                                                               */
/* -------------------------------------------------------------------------- */

const UNKNOWN_READER = 'That is not a reader this site knows.';
const readerRef = z.object({
  deviceId: z.string().regex(READER_DEVICE_ID),
  epoch: z.number().int().min(1),
});

export type ReaderKeyGrant =
  { ok: true; key: string; epoch: number; check: string } | { ok: false; error: string };

function grantFor(key: Buffer, epoch: number): ReaderKeyGrant {
  return { ok: true, key: key.toString('base64url'), epoch, check: readerKeyCheck(key) };
}

/**
 * Gives a reader that has no key the one it will keep. Readers normally get
 * theirs when they are flashed; this is for one that was erased, or flashed
 * without the tool. Such a reader takes a key only over its cable, so only
 * someone holding it can do this.
 */
export async function registerReaderAction(input: { deviceId: string }): Promise<ReaderKeyGrant> {
  const { user } = await requireAdminActor();
  const parsed = readerRef.pick({ deviceId: true }).safeParse(input);
  if (!parsed.success) return { ok: false, error: UNKNOWN_READER };
  if (!(await withinRateLimit(`reader:register:${user.id}`, 20, 600))) {
    return {
      ok: false,
      error: 'Too many readers were set up at once. Try again in a few minutes.',
    };
  }

  const key = newReaderKey();
  const epoch = await storeReaderKey({ deviceId: parsed.data.deviceId, key, actor: user.id });
  if (!epoch) return { ok: false, error: 'The reader could not be set up. Try again.' };
  await audit(user.id, 'reader.paired', 'reader', parsed.data.deviceId, null, null, { epoch });
  return grantFor(key, epoch);
}

/**
 * Makes the key that replaces the one a connected reader holds. The browser
 * passes it to the reader inside the session it already has open, then calls
 * confirmReaderKeyAction. Until that, the old key still works, so a change that
 * is cut short locks nobody out; asking again returns the same new key.
 */
export async function rotateReaderKeyAction(input: {
  deviceId: string;
  epoch: number;
}): Promise<ReaderKeyGrant> {
  const { user } = await requireAdminActor();
  const parsed = readerRef.safeParse(input);
  if (!parsed.success) return { ok: false, error: UNKNOWN_READER };
  const { deviceId, epoch } = parsed.data;
  if (!(await loadReaderKey(deviceId, epoch))) return { ok: false, error: UNKNOWN_READER };
  if (!(await withinRateLimit(`reader:rotate:${user.id}`, 20, 600))) {
    return { ok: false, error: 'Too many key changes at once. Try again in a few minutes.' };
  }

  const next = epoch + 1;
  let stored = await loadReaderKey(deviceId, next);
  if (!stored) {
    await storeReaderKey({ deviceId, key: newReaderKey(), actor: user.id, version: next });
    stored = await loadReaderKey(deviceId, next);
  }
  if (!stored) return { ok: false, error: 'The new key could not be saved. Try again.' };
  await audit(user.id, 'reader.key_rotated', 'reader', deviceId, null, { epoch }, { epoch: next });
  return grantFor(stored.key, next);
}

/**
 * Retires a reader's older keys. Called once the reader has proved, to this
 * organizer's browser, that it holds the version named.
 */
export async function confirmReaderKeyAction(input: {
  deviceId: string;
  epoch: number;
}): Promise<{ ok: boolean }> {
  await requireAdminActor();
  const parsed = readerRef.safeParse(input);
  if (!parsed.success) return { ok: false };
  await retireReaderKeys(parsed.data.deviceId, parsed.data.epoch);
  return { ok: true };
}

export type ReaderSession =
  | { ok: true; proof: string; expect: string; sessionKey: string; older: boolean }
  | { ok: false; error: string };

/**
 * Opens one session with a reader, over its cable or over Bluetooth. The
 * reader's key stays here: the browser gets the proof to send, the proof a
 * genuine reader answers with, and a key that seals this session only. Someone
 * whose access was removed can no longer open a session, whatever their browser
 * remembers.
 */
export async function openReaderSessionAction(input: {
  deviceId: string;
  epoch: number;
  clientNonce: string;
  readerNonce: string;
}): Promise<ReaderSession> {
  const { user } = await requireAdminActor();
  const parsed = readerRef
    .extend({
      clientNonce: z.string().regex(READER_NONCE),
      readerNonce: z.string().regex(READER_NONCE),
    })
    .safeParse(input);
  const clientNonce = parsed.success ? fromBase64Url(parsed.data.clientNonce) : null;
  const readerNonce = parsed.success ? fromBase64Url(parsed.data.readerNonce) : null;
  if (!parsed.success || !clientNonce || !readerNonce) return { ok: false, error: UNKNOWN_READER };
  if (!(await withinRateLimit(`reader:session:${user.id}`, 60, 60))) {
    return { ok: false, error: 'Too many reader connections at once. Try again in a minute.' };
  }

  const stored = await loadReaderKey(parsed.data.deviceId, parsed.data.epoch);
  if (!stored) {
    return {
      ok: false,
      error:
        'This site does not hold this reader’s key. Erase the reader and flash it again to set it up.',
    };
  }
  const secrets = readerSessionSecrets({
    key: stored.key,
    deviceId: parsed.data.deviceId,
    epoch: parsed.data.epoch,
    clientNonce,
    readerNonce,
  });
  return {
    ok: true,
    proof: secrets.clientProof.toString('base64url'),
    expect: secrets.readerProof.toString('base64url'),
    sessionKey: secrets.sessionKey.toString('base64url'),
    older: stored.hasOlder,
  };
}
