import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { buttonVariants, Card, CardContent, DataTable, PageShell, StatusChip, cn } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';
import { EventForm, type EventValues } from '@/components/admin/event-form';
import { setEventStatusAction } from '@/app/(admin)/admin/actions';
import { Flash, SubmitButton } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Edit event',
  robots: { index: false, follow: false },
};

export default async function EditEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { notice, error } = await searchParams;
  const admin = createSupabaseAdmin();
  const returnTo = `/admin/events/${id}`;

  const { data: event } = await admin
    .from('events')
    .select(
      'id, name, slug, summary, location, starts_at, ends_at, status, is_public, event_sessions(id, name, kind, starts_at, ends_at, check_in_opens_at, check_in_closes_at, check_out_opens_at, check_out_closes_at, minimum_duration_minutes, reward_points)',
    )
    .eq('id', id)
    .maybeSingle();
  if (!event) notFound();

  const sessions = Array.isArray(event.event_sessions) ? event.event_sessions : [];
  const values: EventValues = {
    id: event.id as string,
    name: event.name as string,
    slug: event.slug as string,
    summary: (event.summary as string) ?? '',
    location: (event.location as string) ?? '',
    startsAt: event.starts_at as string,
    endsAt: event.ends_at as string,
    status: event.status as string,
    isPublic: Boolean(event.is_public),
    sessions: sessions.map((session) => ({
      id: session.id as string,
      name: session.name as string,
      kind: session.kind as 'main' | 'bonus',
      startsAt: session.starts_at as string,
      endsAt: session.ends_at as string,
      checkInOpensAt: session.check_in_opens_at as string,
      checkInClosesAt: session.check_in_closes_at as string,
      checkOutOpensAt: session.check_out_opens_at as string,
      checkOutClosesAt: session.check_out_closes_at as string,
      minimumDurationMinutes: session.minimum_duration_minutes as number,
      rewardPoints: session.reward_points as number,
    })),
  };

  const { data: attendance } = await admin
    .from('attendance_records')
    .select(
      'id, state, qualified, reward_points, checked_in_at, checked_out_at, duration_minutes, member_id, members(public_number, member_profiles(display_name)), event_sessions!inner(event_id)',
    )
    .eq('event_sessions.event_id', id)
    .order('checked_in_at', { ascending: false })
    .limit(100);

  return (
    <PageShell>
      <Flash notice={notice} error={error} />

      <Link
        href="/admin/events"
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-3 mb-2')}
      >
        <ArrowLeft className="size-4" aria-hidden />
        All events
      </Link>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="type-overline text-primary">{event.status as string}</p>
          <h1 className="type-h2 mt-2">{event.name as string}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {formatDateTime(event.starts_at as string)} → {formatDateTime(event.ends_at as string)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['published', 'completed', 'cancelled'] as const).map((status) => (
            <form action={setEventStatusAction} key={status}>
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="eventId" value={id} />
              <input type="hidden" name="status" value={status} />
              <SubmitButton
                size="small"
                variant="outlined"
                color={status === 'cancelled' ? 'error' : 'primary'}
                pendingLabel="Updating…"
                confirmMessage={
                  status === 'cancelled'
                    ? 'Cancel this event? The public page will be hidden.'
                    : undefined
                }
              >
                Mark {status}
              </SubmitButton>
            </form>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.45fr_1fr] lg:items-start">
        <Card>
          <CardContent className="p-5 sm:p-6">
            <EventForm event={values} returnTo={returnTo} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 sm:p-6">
            <h2 className="mb-4 text-base font-bold">Attendance</h2>
            <DataTable
              caption="Event attendance"
              rows={(attendance ?? []).map((row) => {
                const member = Array.isArray(row.members) ? row.members[0] : row.members;
                const profile = Array.isArray(member?.member_profiles)
                  ? member.member_profiles[0]
                  : member?.member_profiles;
                return {
                  id: row.id as string,
                  name: (profile?.display_name as string) ?? 'Member',
                  number: (member?.public_number as string) ?? '',
                  state: row.state as string,
                  qualified: Boolean(row.qualified),
                  reward: row.reward_points as number,
                  checkedInAt: row.checked_in_at as string,
                  duration: (row.duration_minutes as number | null) ?? null,
                };
              })}
              getRowKey={(row) => row.id}
              emptyMessage="No attendance yet."
              columns={[
                {
                  key: 'member',
                  header: 'Member',
                  render: (row) => (
                    <div>
                      <p className="text-sm font-semibold">{row.name}</p>
                      <p className="text-xs text-muted-foreground">{row.number}</p>
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (row) => <StatusChip status={row.qualified ? 'qualified' : row.state} />,
                },
                {
                  key: 'points',
                  header: 'Pts',
                  align: 'right',
                  render: (row) => <span className="text-sm tabular-nums">{row.reward}</span>,
                },
              ]}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Correct attendance from the member detail page.
            </p>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
