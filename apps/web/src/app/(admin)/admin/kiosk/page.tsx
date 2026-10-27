import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { StatusChip } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { publicPhotoUrl } from '@/lib/profile/photo';
import { formatDateTime } from '@/lib/format';
import { KioskQueue } from '@/components/admin/kiosk-queue';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Kiosk',
  robots: { index: false, follow: false },
};

export default async function KioskPage() {
  await requireAdmin();
  const admin = createSupabaseAdmin();

  const [scans, devices] = await Promise.all([
    admin
      .from('device_scans')
      .select(
        'id, action, status, created_at, expires_at, member_id, members(public_number, member_profiles(display_name, photo_path)), event_sessions(name, events(name)), devices(device_id, lane_label)',
      )
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(10),
    admin
      .from('devices')
      .select('id, device_id, lane_label, mode, status, last_seen_at, firmware_version')
      .order('lane_label'),
  ]);

  const initialScans = (scans.data ?? []).map((scan) => {
    const member = Array.isArray(scan.members) ? scan.members[0] : scan.members;
    const profile = Array.isArray(member?.member_profiles) ? member.member_profiles[0] : member?.member_profiles;
    const session = Array.isArray(scan.event_sessions) ? scan.event_sessions[0] : scan.event_sessions;
    const event = Array.isArray(session?.events) ? session.events[0] : session?.events;
    const device = Array.isArray(scan.devices) ? scan.devices[0] : scan.devices;
    return {
      id: scan.id as string,
      memberId: scan.member_id as string,
      memberName: (profile?.display_name as string) ?? 'Member',
      memberNumber: (member?.public_number as string) ?? '',
      photoUrl: publicPhotoUrl((profile?.photo_path as string) ?? null),
      eventName: (event?.name as string) ?? 'Event',
      sessionName: (session?.name as string) ?? 'Session',
      suggestedAction: (scan.action as string) ?? 'check_in',
      lane: (device?.lane_label as string) ?? 'Kiosk',
      createdAt: scan.created_at as string,
      expiresAt: scan.expires_at as string,
    };
  });

  return (
    <Container maxWidth="xl" sx={{ pb: 8 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mb: 3 }}>
        <Box>
          <Typography variant="overline" color="primary">
            Human confirmation required
          </Typography>
          <Typography variant="h2" component="h1" sx={{ fontSize: { xs: '2rem', md: '2.5rem' } }}>
            Kiosk
          </Typography>
          <Typography color="text.secondary">
            Scans queue here. A tap never awards points; confirm check-in and check-out in person.
          </Typography>
        </Box>
        <StatusChip status={initialScans.length > 0 ? 'active' : 'pending'} label={`${initialScans.length} pending`} />
      </Stack>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <KioskQueue initialScans={initialScans} />
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h5" sx={{ mb: 2 }}>
                Lanes
              </Typography>
              <Stack spacing={1.5}>
                {(devices.data ?? []).map((device) => (
                  <Box key={device.id as string} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography variant="subtitle2">{device.lane_label as string}</Typography>
                      <StatusChip status={device.status as string} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {device.device_id as string} · {device.mode as string}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Last seen: {device.last_seen_at ? formatDateTime(device.last_seen_at as string) : 'never'}
                      {device.firmware_version ? ` · ${device.firmware_version as string}` : ''}
                    </Typography>
                  </Box>
                ))}
                {(devices.data ?? []).length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No devices registered. Register one under Devices before event day.
                  </Typography>
                ) : null}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
