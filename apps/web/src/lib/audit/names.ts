import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AuditRow = {
  actor_auth_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Named = { display_name?: unknown } | { display_name?: unknown }[] | null | undefined;

function displayName(profile: Named): string | null {
  const row = Array.isArray(profile) ? profile[0] : profile;
  return typeof row?.display_name === 'string' ? row.display_name : null;
}

function one<T>(value: T | T[] | null | undefined): T | undefined {
  return (Array.isArray(value) ? value[0] : value) ?? undefined;
}

/**
 * Looks up who did each entry and who or what it was about, in one query per
 * kind of record. Audit entries outlive what they point at, so every name here
 * may be missing and callers fall back to a neutral word.
 */
export async function loadAuditNames(admin: SupabaseClient, rows: AuditRow[]) {
  const idsOf = (type: string) => [
    ...new Set(
      rows
        .filter((row) => row.target_type === type && row.target_id && UUID.test(row.target_id))
        .map((row) => row.target_id as string),
    ),
  ];
  const authIds = [
    ...new Set([
      ...rows.flatMap((row) => (row.actor_auth_id ? [row.actor_auth_id] : [])),
      ...idsOf('user'),
    ]),
  ];
  const memberIds = idsOf('member');
  const eventIds = idsOf('event');
  const rewardIds = idsOf('reward');
  const redemptionIds = idsOf('redemption');
  const attendanceIds = idsOf('attendance');
  const none = Promise.resolve({ data: [] as Record<string, unknown>[] });

  const [byAuth, byMember, events, rewards, redemptions, attendance] = await Promise.all([
    authIds.length
      ? admin
          .from('members')
          .select('auth_user_id, member_profiles(display_name)')
          .in('auth_user_id', authIds)
      : none,
    memberIds.length
      ? admin.from('members').select('id, member_profiles(display_name)').in('id', memberIds)
      : none,
    eventIds.length ? admin.from('events').select('id, name').in('id', eventIds) : none,
    rewardIds.length ? admin.from('rewards').select('id, name').in('id', rewardIds) : none,
    redemptionIds.length
      ? admin
          .from('redemptions')
          .select('id, reward_name_snapshot, members(member_profiles(display_name))')
          .in('id', redemptionIds)
      : none,
    attendanceIds.length
      ? admin
          .from('attendance_records')
          .select('id, members(member_profiles(display_name))')
          .in('id', attendanceIds)
      : none,
  ]);

  const people = new Map<string, string>();
  for (const row of (byAuth.data ?? []) as Record<string, unknown>[]) {
    const name = displayName(row.member_profiles as Named);
    if (name) people.set(row.auth_user_id as string, name);
  }
  const targets = new Map<string, string>();
  for (const [id, name] of people) targets.set(`user:${id}`, name);
  for (const row of (byMember.data ?? []) as Record<string, unknown>[]) {
    const name = displayName(row.member_profiles as Named);
    if (name) targets.set(`member:${row.id as string}`, name);
  }
  for (const row of (events.data ?? []) as Record<string, unknown>[]) {
    targets.set(`event:${row.id as string}`, row.name as string);
  }
  for (const row of (rewards.data ?? []) as Record<string, unknown>[]) {
    targets.set(`reward:${row.id as string}`, row.name as string);
  }
  for (const row of (attendance.data ?? []) as Record<string, unknown>[]) {
    const member = one(row.members as { member_profiles?: Named } | { member_profiles?: Named }[]);
    const name = displayName(member?.member_profiles);
    if (name) targets.set(`attendance:${row.id as string}`, name);
  }
  const requests = new Map<string, { reward: string; member: string | null }>();
  for (const row of (redemptions.data ?? []) as Record<string, unknown>[]) {
    const member = one(row.members as { member_profiles?: Named } | { member_profiles?: Named }[]);
    requests.set(row.id as string, {
      reward: row.reward_name_snapshot as string,
      member: displayName(member?.member_profiles),
    });
  }

  return {
    /** The name of whoever did it, or null when their profile is gone. */
    actor: (row: AuditRow) => (row.actor_auth_id ? (people.get(row.actor_auth_id) ?? null) : null),
    /** Who or what the entry was about, worded to fit its sentence. */
    target(row: AuditRow): string | null {
      if (!row.target_id) return null;
      if (row.target_type === 'redemption') {
        const request = requests.get(row.target_id);
        if (!request) return null;
        // The member is the one acting on their own request, so only the reward is named.
        if (
          row.action === 'redemption.requested' ||
          row.action === 'redemption.cancelled_by_member'
        )
          return request.reward;
        if (!request.member) return null;
        return row.action === 'redemption.fulfil'
          ? `${request.reward} to ${request.member}`
          : `${request.member}'s request for ${request.reward}`;
      }
      // A new reward is recorded by its name, before it has an id.
      if (row.target_type === 'reward' && !UUID.test(row.target_id)) return row.target_id;
      return targets.get(`${row.target_type}:${row.target_id}`) ?? null;
    },
  };
}
