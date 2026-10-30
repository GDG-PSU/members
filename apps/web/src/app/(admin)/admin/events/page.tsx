import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageShell,
  StatusChip,
} from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';
import { EventForm } from '@/components/admin/event-form';
import { Flash } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Events',
  robots: { index: false, follow: false },
};

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  await requireAdmin();
  const { notice, error } = await searchParams;
  const admin = createSupabaseAdmin();
  const { data: events } = await admin
    .from('events')
    .select(
      'id, name, slug, starts_at, ends_at, status, is_public, event_sessions(kind, reward_points, minimum_duration_minutes)',
    )
    .order('starts_at', { ascending: false })
    .limit(60);

  return (
    <PageShell>
      <Flash notice={notice} error={error} />

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <section>
          <p className="type-overline text-primary">Calendar</p>
          <h1 className="type-h2 mb-4 mt-2">Events</h1>

          {!events || events.length === 0 ? (
            <EmptyState title="No events yet" description="Create your first event." />
          ) : (
            <div className="space-y-3">
              {events.map((event) => {
                const sessions = Array.isArray(event.event_sessions) ? event.event_sessions : [];
                const main = sessions.find((session) => session.kind === 'main');
                return (
                  <Link
                    key={event.id as string}
                    href={`/admin/events/${event.id}`}
                    className="group block rounded-2xl focus-visible:outline-none"
                  >
                    <Card className="transition-colors group-hover:border-primary/50 group-hover:shadow-lift">
                      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h2 className="text-base font-bold leading-snug">
                            {event.name as string}
                          </h2>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDateTime(event.starts_at as string)} →{' '}
                            {formatDateTime(event.ends_at as string)}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {main
                              ? `Main reward ${main.reward_points as number} pts · min ${main.minimum_duration_minutes as number} min`
                              : 'No main session'}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          {event.is_public ? null : <StatusChip status="draft" label="private" />}
                          <StatusChip status={event.status as string} />
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
        </section>

        <section className="lg:sticky lg:top-24">
          <Card>
            <CardHeader>
              <CardTitle>New event</CardTitle>
            </CardHeader>
            <CardContent>
              <EventForm returnTo="/admin/events" />
            </CardContent>
          </Card>
        </section>
      </div>
    </PageShell>
  );
}
