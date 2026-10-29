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
import {
  DeviceCreateForm,
  DeviceEditForm,
  type EventOption,
} from '@/components/admin/device-forms';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Devices',
  robots: { index: false, follow: false },
};

export default async function DevicesPage() {
  await requireAdmin();
  const admin = createSupabaseAdmin();

  const [devices, events] = await Promise.all([
    admin
      .from('devices')
      .select(
        'id, device_id, lane_label, mode, status, last_seen_at, firmware_version, event_id, session_id, rotated_at',
      )
      .order('lane_label'),
    admin
      .from('events')
      .select('id, name, event_sessions(id, name, kind)')
      .in('status', ['draft', 'published'])
      .order('starts_at', { ascending: false })
      .limit(20),
  ]);

  const eventOptions: EventOption[] = (events.data ?? []).map((event) => ({
    id: event.id as string,
    name: event.name as string,
    sessions: (Array.isArray(event.event_sessions) ? event.event_sessions : []).map((session) => ({
      id: session.id as string,
      name: session.name as string,
      kind: session.kind as string,
    })),
  }));

  return (
    <Container maxWidth="xl" sx={{ pb: 8 }}>
      <Grid container spacing={4}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Typography variant="overline" color="primary">
            Hardware
          </Typography>
          <Typography
            variant="h2"
            component="h1"
            sx={{ mb: 1, fontSize: { xs: '2rem', md: '2.5rem' } }}
          >
            Devices
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Each ESP32 lane authenticates with its own ID and secret. Writer mode temporarily stops
            attendance scans on that lane.
          </Typography>

          {!devices.data || devices.data.length === 0 ? (
            <EmptyState
              title="No devices registered"
              description="Register lane A and lane B before event day."
            />
          ) : (
            <Stack spacing={2}>
              {devices.data.map((device) => (
                <Card key={device.id as string}>
                  <CardContent sx={{ p: 2.5 }}>
                    <Stack
                      direction="row"
                      spacing={1.5}
                      sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
                    >
                      <Box>
                        <Typography variant="h5">{device.lane_label as string}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {device.device_id as string} · last seen{' '}
                          {device.last_seen_at
                            ? formatDateTime(device.last_seen_at as string)
                            : 'never'}
                          {device.firmware_version
                            ? ` · fw ${device.firmware_version as string}`
                            : ''}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={1}>
                        <StatusChip status={device.status as string} />
                        <StatusChip status={device.mode as string} />
                      </Stack>
                    </Stack>
                    <DeviceEditForm
                      device={{
                        id: device.id as string,
                        deviceId: device.device_id as string,
                        laneLabel: device.lane_label as string,
                        mode: device.mode as string,
                        status: device.status as string,
                        eventId: (device.event_id as string | null) ?? null,
                        sessionId: (device.session_id as string | null) ?? null,
                      }}
                      events={eventOptions}
                    />
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mt: 1 }}
                    >
                      Rotating the secret takes effect on the device&apos;s next request. Update the
                      firmware secrets file before restarting that lane.
                    </Typography>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ position: { md: 'sticky' }, top: { md: 96 } }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h4" sx={{ mb: 1 }}>
                Register a lane
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                The secret is shown once. Only its SHA-256 hash is stored; firmware never receives a
                Supabase key.
              </Typography>
              <DeviceCreateForm events={eventOptions} />
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
