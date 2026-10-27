import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { EmptyState, StatusChip } from '@gdg/ui';
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
    .select('id, name, slug, starts_at, ends_at, status, is_public, event_sessions(kind, reward_points, minimum_duration_minutes)')
    .order('starts_at', { ascending: false })
    .limit(60);

  return (
    <Container maxWidth="xl" sx={{ pb: 8 }}>
      <Flash notice={notice} error={error} />
      <Grid container spacing={4}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Typography variant="overline" color="primary">
            Calendar
          </Typography>
          <Typography variant="h2" component="h1" sx={{ mb: 2, fontSize: { xs: '2rem', md: '2.5rem' } }}>
            Events
          </Typography>
          {!events || events.length === 0 ? (
            <EmptyState title="No events yet" description="Create the first event with the form." />
          ) : (
            <Stack spacing={1.5}>
              {events.map((event) => {
                const sessions = Array.isArray(event.event_sessions) ? event.event_sessions : [];
                const main = sessions.find((session) => session.kind === 'main');
                return (
                  <Card key={event.id as string} component="a" href={`/admin/events/${event.id}`} sx={{ textDecoration: 'none', '&:hover': { borderColor: 'primary.main' } }}>
                    <CardContent sx={{ p: 2.5 }}>
                      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="h5">{event.name as string}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDateTime(event.starts_at as string)} → {formatDateTime(event.ends_at as string)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {main
                              ? `Main reward ${main.reward_points as number} pts · min ${main.minimum_duration_minutes as number} min`
                              : 'No main session'}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          {event.is_public ? null : <StatusChip status="draft" label="private" />}
                          <StatusChip status={event.status as string} />
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                );
              })}
            </Stack>
          )}
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h4" sx={{ mb: 2 }}>
                New event
              </Typography>
              <EventForm returnTo="/admin/events" />
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
