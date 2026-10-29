import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { MetricCard } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin overview',
  robots: { index: false, follow: false },
};

export default async function AdminOverviewPage() {
  await requireAdmin();
  const admin = createSupabaseAdmin();

  const [members, invites, scans, jobs, redemptions, rewards, recentAudit] = await Promise.all([
    admin.from('members').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    admin
      .from('member_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    admin.from('device_scans').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    admin
      .from('card_write_jobs')
      .select('id', { count: 'exact', head: true })
      .in('status', ['queued', 'claimed']),
    admin
      .from('redemptions')
      .select('id', { count: 'exact', head: true })
      .in('status', ['requested', 'approved']),
    admin.from('rewards').select('id', { count: 'exact', head: true }).eq('is_active', true),
    admin
      .from('audit_log')
      .select('id, action, target_type, target_id, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  return (
    <Container maxWidth="xl" sx={{ pb: 8 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mb: 3 }}
      >
        <Box>
          <Typography variant="overline" color="primary">
            Organizer console
          </Typography>
          <Typography variant="h2" component="h1" sx={{ fontSize: { xs: '2rem', md: '2.5rem' } }}>
            Event control
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <Button component="a" href="/admin/kiosk" variant="contained">
            Open kiosk
          </Button>
          <Button component="a" href="/admin/events" variant="outlined">
            Events
          </Button>
        </Stack>
      </Stack>

      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <MetricCard label="Active members" value={members.count ?? 0} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <MetricCard label="Pending invitations" value={invites.count ?? 0} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <MetricCard
            label="Pending scans"
            value={scans.count ?? 0}
            hint="Awaiting human confirmation"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <MetricCard label="Open redemption requests" value={redemptions.count ?? 0} />
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h5" sx={{ mb: 2 }}>
                Recent actions
              </Typography>
              <Stack spacing={1.5}>
                {(recentAudit.data ?? []).map((row) => (
                  <Stack
                    key={row.id as number}
                    direction="row"
                    spacing={2}
                    sx={{ alignItems: 'baseline' }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 138 }}>
                      {formatDateTime(row.created_at as string)}
                    </Typography>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle2">{row.action as string}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.target_type as string}
                        {row.reason ? ` · ${row.reason as string}` : ''}
                      </Typography>
                    </Box>
                  </Stack>
                ))}
                {(recentAudit.data ?? []).length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No admin actions recorded yet.
                  </Typography>
                ) : null}
              </Stack>
              <Button
                component="a"
                href="/admin/audit"
                size="small"
                endIcon={<ArrowForwardIcon />}
                sx={{ mt: 2 }}
              >
                Full audit log
              </Button>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h5" sx={{ mb: 2 }}>
                Event readiness
              </Typography>
              <Stack spacing={1.5}>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="body2">Queued card writes</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {jobs.count ?? 0}
                  </Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="body2">Active rewards</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {rewards.count ?? 0}
                  </Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="body2">Pending scans</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {scans.count ?? 0}
                  </Typography>
                </Stack>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                Card writes and kiosk confirmations require a human in the loop. Points are never
                granted by a tap alone.
              </Typography>
              <Button
                component="a"
                href="/admin/devices"
                size="small"
                sx={{ mt: 2 }}
                endIcon={<ArrowForwardIcon />}
              >
                Device health
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
