import 'server-only';
import type { LeaderboardEntry, PublicProfile } from '@gdg/contracts';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { profilePhotoUrl } from '@/lib/profile/photo';

export interface PublicEventSummary {
  id: string;
  name: string;
  slug: string;
  summary: string;
  location: string;
  startsAt: string;
  endsAt: string;
}

export interface PublicSession {
  id: string;
  name: string;
  kind: 'main' | 'bonus';
  startsAt: string;
  endsAt: string;
  rewardPoints: number;
  minimumDurationMinutes: number;
}

export async function listLeaderboard(limit = 25, offset = 0): Promise<LeaderboardEntry[]> {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from('leaderboard')
    .select('rank, slug, display_name, photo_path, member_number, points')
    .order('rank', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`leaderboard: ${error.message}`);

  return (data ?? []).map((row) => ({
    rank: row.rank as number,
    slug: row.slug as string,
    displayName: row.display_name as string,
    photoUrl: profilePhotoUrl(row.photo_path as string | null),
    memberNumber: (row.member_number as string | null) ?? null,
    points: row.points as number,
  }));
}

export async function countLeaderboard(): Promise<number> {
  const supabase = createSupabaseAdmin();
  const { count } = await supabase
    .from('leaderboard')
    .select('slug', { count: 'exact', head: true });
  return count ?? 0;
}

export async function listPublicEvents(limit = 24): Promise<PublicEventSummary[]> {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from('events')
    .select('id, name, slug, summary, location, starts_at, ends_at')
    .eq('status', 'published')
    .eq('is_public', true)
    .order('starts_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`events: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    summary: row.summary as string,
    location: row.location as string,
    startsAt: row.starts_at as string,
    endsAt: row.ends_at as string,
  }));
}

export async function getPublicEvent(
  slug: string,
): Promise<{ event: PublicEventSummary; sessions: PublicSession[] } | null> {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from('events')
    .select(
      'id, name, slug, summary, location, starts_at, ends_at, event_sessions(id, name, kind, starts_at, ends_at, reward_points, minimum_duration_minutes, is_enabled)',
    )
    .eq('slug', slug)
    .eq('status', 'published')
    .eq('is_public', true)
    .maybeSingle();
  if (error || !data) return null;

  const sessions = (Array.isArray(data.event_sessions) ? data.event_sessions : [])
    .filter((session) => session.is_enabled)
    .map((session) => ({
      id: session.id as string,
      name: session.name as string,
      kind: session.kind as 'main' | 'bonus',
      startsAt: session.starts_at as string,
      endsAt: session.ends_at as string,
      rewardPoints: session.reward_points as number,
      minimumDurationMinutes: session.minimum_duration_minutes as number,
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return {
    event: {
      id: data.id as string,
      name: data.name as string,
      slug: data.slug as string,
      summary: data.summary as string,
      location: data.location as string,
      startsAt: data.starts_at as string,
      endsAt: data.ends_at as string,
    },
    sessions,
  };
}

export async function getPublicProfile(slug: string): Promise<PublicProfile | null> {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from('public_profiles')
    .select(
      'slug, display_name, photo_path, about, links, member_number, member_since, points, stars, attended_events, email, created_at',
    )
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data) return null;

  const links = Array.isArray(data.links)
    ? (data.links as { label?: unknown; url?: unknown }[])
        .filter(
          (link): link is { label: string; url: string } =>
            typeof link?.label === 'string' &&
            typeof link?.url === 'string' &&
            link.url.startsWith('https://'),
        )
        .slice(0, 6)
    : [];

  return {
    slug: data.slug as string,
    displayName: (data.display_name as string | null) ?? null,
    photoUrl: profilePhotoUrl((data.photo_path as string | null) ?? null),
    about: (data.about as string | null) ?? null,
    links,
    memberNumber: (data.member_number as string | null) ?? null,
    memberSince: (data.member_since as string | null) ?? null,
    points: (data.points as number | null) ?? null,
    stars: (data.stars as number | null) ?? null,
    attendedEvents: (data.attended_events as number | null) ?? null,
    email: (data.email as string | null) ?? null,
    createdAt: data.created_at as string,
  };
}
