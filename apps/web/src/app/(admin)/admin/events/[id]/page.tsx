import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { DataTable, StatusChip } from '@gdg/ui';
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
    <Container maxWidth="xl" sx={{ pb: 8 }}>
      <Flash notice={notice} error={error} />
      <Button component="a" href="/admin/events" size="small" sx={{ mb: 2 }}>
        ← All events
      </Button>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mb: 3 }}>
        <Box>
          <Typography variant="overline" color="primary">
            {event.status as string}
          </Typography>
          <Typography variant="h2" component="h1" sx={{ fontSize: { xs: '2rem', md: '2.5rem' } }}>
            {event.name as string}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {formatDateTime(event.starts_at as string)} → {formatDateTime(event.ends_at as string)}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          {(['published', 'completed', 'cancelled'] as const).map((status) => (
            <Box component="form" action={setEventStatusAction} key={status}>
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="eventId" value={id} />
              <input type="hidden" name="status" value={status} />
              <SubmitButton
                size="small"
                variant="outlined"
                color={status === 'cancelled' ? 'error' : 'primary'}
                pendingLabel="Updating…"
                confirmMessage={status === 'cancelled' ? 'Cancel this event? The public page will be hidden.' : undefined}
              >
                Mark {status}
              </SubmitButton>
            </Box>
          ))}
        </Stack>
      </Stack>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <EventForm event={values} returnTo={returnTo} />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h5" sx={{ mb: 2 }}>
                Attendance
              </Typography>
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
                      <Box>
                        <Typography variant="subtitle2">{row.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {row.number}
                        </Typography>
                      </Box>
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
                    render: (row) => <Typography variant="body2">{row.reward}</Typography>,
                  },
                ]}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                Corrections are made from the member detail page so each change carries a reason and actor.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
