import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Plus } from 'lucide-react';
import { buttonVariants, Card, CardContent, EmptyState, PageShell, StatusChip } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { eventStage, type EventStage } from '@/lib/events/attendance-rules';
import { formatDateTime, formatTime, pluralize } from '@/lib/format';
import { Flash } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Events',
  robots: { index: false, follow: false },
};

const STAGE_CHIPS: Record<EventStage, { status: string; label: string }> = {
  draft: { status: 'draft', label: 'Draft' },
  published: { status: 'published', label: 'Published' },
  ended: { status: 'completed', label: 'Ended' },
  cancelled: { status: 'cancelled', label: 'Cancelled' },
};

async function loadEvents() {
  const { data } = await createSupabaseAdmin()
    .from('events')
    .select(
      'id, name, starts_at, ends_at, location, status, is_public, event_sessions(kind, reward_points, is_enabled)',
    )
    .order('starts_at', { ascending: false })
    .limit(60);
  const now = Date.now();
  return (data ?? []).map((event) => {
    const sessions = (Array.isArray(event.event_sessions) ? event.event_sessions : []).filter(
      (session) => session.is_enabled,
    );
    return {
      id: event.id as string,
      name: event.name as string,
      startsAt: event.starts_at as string,
      endsAt: event.ends_at as string,
      location: (event.location as string) ?? '',
      isPublic: Boolean(event.is_public),
      stage: eventStage(event.status as string, event.ends_at as string, now),
      points: sessions.reduce((total, session) => total + (session.reward_points as number), 0),
      hasBonus: sessions.some((session) => session.kind === 'bonus'),
    };
  });
}

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  await requireAdmin();
  const { notice, error } = await searchParams;
  const events = await loadEvents();

  return (
    <PageShell width="lg">
      <Flash notice={notice} error={error} />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="type-overline text-primary">Calendar</p>
          <h1 className="type-h2 mt-2">Events</h1>
        </div>
        <Link href="/admin/events/new" className={buttonVariants({})}>
          <Plus className="size-4" aria-hidden />
          New event
        </Link>
      </div>

      {events.length === 0 ? (
        <EmptyState
          title="No events yet"
          description="Create your first event. It starts as a draft."
        />
      ) : (
        <div className="space-y-3">
          {events.map((event) => {
            const chip = STAGE_CHIPS[event.stage];
            return (
              <Link
                key={event.id}
                href={`/admin/events/${event.id}`}
                className="group block rounded-2xl focus-visible:outline-none"
              >
                <Card className="transition-colors group-hover:bg-muted">
                  <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="text-base font-bold leading-snug">{event.name}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(event.startsAt)} – {formatTime(event.endsAt)}
                        {event.location ? ` · ${event.location}` : ''}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {event.points} {pluralize(event.points, 'point')}
                        {event.hasBonus ? ' with the bonus session' : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {event.isPublic ? null : (
                        <StatusChip status="draft" label="Not on public page" />
                      )}
                      <StatusChip status={chip.status} label={chip.label} />
                      <ArrowRight
                        className="ml-1 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                        aria-hidden
                      />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
