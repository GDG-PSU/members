import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, ScanLine } from 'lucide-react';
import { buttonVariants, Card, CardContent, DataTable, PageShell, StatusChip, cn } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import {
  describeAttendanceRule,
  eventStage,
  rulesFromWindows,
  type EventStage,
} from '@/lib/events/attendance-rules';
import { formatDateTime, formatTime } from '@/lib/format';
import { EventForm, type EventValues } from '@/components/admin/event-form';
import { setEventStatusAction } from '@/app/(admin)/admin/actions';
import { Flash, SubmitButton } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Event',
  robots: { index: false, follow: false },
};

const STAGE_CHIPS: Record<EventStage, { status: string; label: string }> = {
  draft: { status: 'draft', label: 'Draft' },
  published: { status: 'published', label: 'Published' },
  ended: { status: 'completed', label: 'Ended' },
  cancelled: { status: 'cancelled', label: 'Cancelled' },
};

const METHOD_LABELS: Record<string, string> = {
  card: 'card',
  qr: 'QR code',
  manual: 'found by organizer',
};

type StatusChange = {
  status: 'draft' | 'published' | 'cancelled';
  label: string;
  danger?: boolean;
  confirm?: string;
};

const STATUS_CHANGES: Record<EventStage, StatusChange[]> = {
  draft: [{ status: 'published', label: 'Publish' }],
  published: [
    { status: 'draft', label: 'Unpublish' },
    {
      status: 'cancelled',
      label: 'Cancel event',
      danger: true,
      confirm: 'Cancel this event? It disappears from the public page and the kiosk.',
    },
  ],
  ended: [{ status: 'draft', label: 'Unpublish' }],
  cancelled: [{ status: 'draft', label: 'Restore as draft' }],
};

async function loadEvent(id: string) {
  const admin = createSupabaseAdmin();
  const { data: event } = await admin
    .from('events')
    .select(
      'id, name, slug, summary, location, starts_at, ends_at, status, is_public, event_sessions(id, name, kind, starts_at, ends_at, check_in_closes_at, check_out_opens_at, reward_points, is_enabled)',
    )
    .eq('id', id)
    .maybeSingle();
  if (!event) return null;

  const { data: attendance } = await admin
    .from('attendance_records')
    .select(
      'id, state, qualified, reward_points, checked_in_at, checked_out_at, check_in_method, check_out_method, members(public_number, member_profiles(display_name)), event_sessions!inner(event_id, name, kind)',
    )
    .eq('event_sessions.event_id', id)
    .order('checked_in_at', { ascending: false })
    .limit(500);

  return { event, attendance: attendance ?? [], stage: eventStage(event.status, event.ends_at) };
}

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
  const loaded = await loadEvent(id);
  if (!loaded) notFound();
  const { event, attendance, stage } = loaded;
  const returnTo = `/admin/events/${id}`;

  const sessions = (Array.isArray(event.event_sessions) ? event.event_sessions : []).filter(
    (session) => session.is_enabled,
  );
  const main = sessions.find((session) => session.kind === 'main');
  const bonus = sessions.find((session) => session.kind === 'bonus');
  const windows = main
    ? {
        startsAt: main.starts_at as string,
        endsAt: main.ends_at as string,
        checkInClosesAt: main.check_in_closes_at as string,
        checkOutOpensAt: main.check_out_opens_at as string,
      }
    : null;
  const values: EventValues = {
    id: event.id as string,
    name: event.name as string,
    summary: (event.summary as string) ?? '',
    location: (event.location as string) ?? '',
    startsAt: event.starts_at as string,
    endsAt: event.ends_at as string,
    isPublic: Boolean(event.is_public),
    points: (main?.reward_points as number | undefined) ?? 0,
    ...(windows ? rulesFromWindows(windows) : { arriveBy: '30', leaveFrom: '15' }),
    bonus: bonus
      ? {
          name: bonus.name as string,
          startsAt: bonus.starts_at as string,
          endsAt: bonus.ends_at as string,
          points: bonus.reward_points as number,
        }
      : null,
  };

  const rows = attendance.map((row) => {
    const member = Array.isArray(row.members) ? row.members[0] : row.members;
    const profile = Array.isArray(member?.member_profiles)
      ? member.member_profiles[0]
      : member?.member_profiles;
    const session = Array.isArray(row.event_sessions) ? row.event_sessions[0] : row.event_sessions;
    return {
      id: row.id as string,
      name: (profile?.display_name as string) ?? 'Member',
      number: (member?.public_number as string) ?? '',
      session: session?.kind === 'bonus' ? (session.name as string) : null,
      state: row.state as string,
      qualified: Boolean(row.qualified),
      reward: row.reward_points as number,
      checkedInAt: row.checked_in_at as string,
      checkedOutAt: (row.checked_out_at as string | null) ?? null,
      checkInMethod: (row.check_in_method as string) ?? 'card',
      checkOutMethod: (row.check_out_method as string | null) ?? null,
    };
  });
  const checkedOut = rows.filter((row) => row.checkedOutAt).length;
  const chip = STAGE_CHIPS[stage];

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
          <StatusChip status={chip.status} label={chip.label} />
          <h1 className="type-h2 mt-2">{event.name as string}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {formatDateTime(event.starts_at as string)} – {formatTime(event.ends_at as string)}
            {event.location ? ` · ${event.location as string}` : ''}
          </p>
          {windows && stage !== 'cancelled' ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {describeAttendanceRule(windows)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {stage === 'published' && main ? (
            <Link
              href={`/admin/kiosk?session=${main.id as string}`}
              className={buttonVariants({ size: 'sm' })}
            >
              <ScanLine className="size-4" aria-hidden />
              Open kiosk
            </Link>
          ) : null}
          {(stage === 'published' || stage === 'ended') && event.is_public ? (
            <Link
              href={`/events/${event.slug as string}`}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              <ExternalLink className="size-4" aria-hidden />
              Public page
            </Link>
          ) : null}
          {STATUS_CHANGES[stage].map((change) => (
            <form action={setEventStatusAction} key={change.status}>
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="eventId" value={id} />
              <input type="hidden" name="status" value={change.status} />
              <SubmitButton
                size="small"
                variant={change.status === 'published' ? 'contained' : 'outlined'}
                color={change.danger ? 'error' : 'primary'}
                pendingLabel="Updating…"
                confirmMessage={change.confirm}
              >
                {change.label}
              </SubmitButton>
            </form>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-start">
        <Card>
          <CardContent className="p-5 sm:p-6">
            <h2 className="mb-4 text-base font-bold">Details</h2>
            <EventForm event={values} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 sm:p-6">
            <h2 className="text-base font-bold">Attendance</h2>
            <p className="mb-4 mt-1 text-sm text-muted-foreground">
              {rows.length === 0
                ? 'Nobody has checked in yet.'
                : `${rows.length} checked in · ${checkedOut} checked out`}
            </p>
            {rows.length > 0 ? (
              <DataTable
                caption="Event attendance"
                rows={rows}
                getRowKey={(row) => row.id}
                emptyMessage="No attendance yet."
                columns={[
                  {
                    key: 'member',
                    header: 'Member',
                    render: (row) => (
                      <div>
                        <p className="text-sm font-semibold">{row.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.number}
                          {row.session ? ` · ${row.session}` : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          In {formatTime(row.checkedInAt)}, {METHOD_LABELS[row.checkInMethod]}
                          {row.checkedOutAt
                            ? ` · out ${formatTime(row.checkedOutAt)}, ${
                                METHOD_LABELS[row.checkOutMethod ?? 'card']
                              }`
                            : ''}
                        </p>
                      </div>
                    ),
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (row) => (
                      <StatusChip status={row.qualified ? 'qualified' : row.state} />
                    ),
                  },
                  {
                    key: 'points',
                    header: 'Pts',
                    align: 'right',
                    render: (row) => <span className="text-sm tabular-nums">{row.reward}</span>,
                  },
                ]}
              />
            ) : null}
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              A superadmin can correct a record from that member&apos;s page in Users.
            </p>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
