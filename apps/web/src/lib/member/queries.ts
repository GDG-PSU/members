import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MemberBalance {
  points: number;
  stars: number;
}

export interface AttendanceRow {
  id: string;
  state: string;
  qualified: boolean;
  rewardPoints: number;
  checkedInAt: string;
  checkedOutAt: string | null;
  durationMinutes: number | null;
  sessionName: string;
  sessionKind: string;
  eventName: string;
  eventSlug: string;
  eventStartsAt: string;
}

export interface LedgerRow {
  id: number;
  delta: number;
  kind: string;
  description: string;
  createdAt: string;
}

export interface CardStatus {
  id: string | null;
  status: 'none' | 'pending' | 'active' | 'revoked' | 'lost' | 'replaced';
}

export async function getBalances(
  supabase: SupabaseClient,
  memberId: string,
): Promise<MemberBalance> {
  const { data } = await supabase
    .from('member_balances')
    .select('points, stars')
    .eq('member_id', memberId)
    .maybeSingle();
  return { points: data?.points ?? 0, stars: data?.stars ?? 0 };
}

export async function getRecentAttendance(
  supabase: SupabaseClient,
  memberId: string,
  limit = 10,
): Promise<AttendanceRow[]> {
  const { data } = await supabase
    .from('attendance_records')
    .select(
      'id, state, qualified, reward_points, checked_in_at, checked_out_at, duration_minutes, event_sessions(name, kind, events(name, slug, starts_at))',
    )
    .eq('member_id', memberId)
    .order('checked_in_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => {
    const session = Array.isArray(row.event_sessions) ? row.event_sessions[0] : row.event_sessions;
    const event = Array.isArray(session?.events) ? session.events[0] : session?.events;
    return {
      id: row.id as string,
      state: row.state as string,
      qualified: Boolean(row.qualified),
      rewardPoints: (row.reward_points as number) ?? 0,
      checkedInAt: row.checked_in_at as string,
      checkedOutAt: (row.checked_out_at as string | null) ?? null,
      durationMinutes: (row.duration_minutes as number | null) ?? null,
      sessionName: (session?.name as string) ?? 'Session',
      sessionKind: (session?.kind as string) ?? 'main',
      eventName: (event?.name as string) ?? 'Event',
      eventSlug: (event?.slug as string) ?? '',
      eventStartsAt: (event?.starts_at as string) ?? (row.checked_in_at as string),
    };
  });
}

export async function getLedger(
  supabase: SupabaseClient,
  memberId: string,
  limit = 25,
): Promise<LedgerRow[]> {
  const { data } = await supabase
    .from('point_ledger')
    .select('id, delta, kind, description, created_at')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []).map((row) => ({
    id: row.id as number,
    delta: row.delta as number,
    kind: row.kind as string,
    description: row.description as string,
    createdAt: row.created_at as string,
  }));
}

export async function getCardStatus(
  supabase: SupabaseClient,
  memberId: string,
): Promise<CardStatus> {
  const { data } = await supabase
    .from('card_credentials')
    .select('id, status')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { id: null, status: 'none' };
  return { id: data.id as string, status: data.status as CardStatus['status'] };
}

export async function getActiveCardUrl(
  supabase: SupabaseClient,
  memberId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('card_credentials')
    .select('token_ciphertext, status')
    .eq('member_id', memberId)
    .eq('status', 'active')
    .maybeSingle();
  if (!data?.token_ciphertext) return null;
  const { decryptSecret } = await import('@/lib/security/tokens');
  const token = decryptSecret(data.token_ciphertext as string);
  return `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/c/${token}`;
}
