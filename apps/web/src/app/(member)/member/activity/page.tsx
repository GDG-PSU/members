import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { EmptyState, SectionHeading, StatusChip } from '@gdg/ui';
import { requireMember } from '@/lib/auth/viewer';
import { getBalances, getLedger, getRecentAttendance } from '@/lib/member/queries';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Activity',
  robots: { index: false, follow: false },
};

const kindLabels: Record<string, string> = {
  attendance_reward: 'Attendance',
  interaction_reward: 'Organizer award',
  redemption: 'Reward redeemed',
  redemption_refund: 'Redemption refund',
  reversal: 'Correction',
  admin_adjustment: 'Adjustment',
};

export default async function ActivityPage() {
  const { member, supabase } = await requireMember();
  const [balances, attendance, ledger] = await Promise.all([
    getBalances(supabase, member.id),
    getRecentAttendance(supabase, member.id, 50),
    getLedger(supabase, member.id, 50),
  ]);

  return (
    <Container maxWidth="lg" sx={{ pb: { xs: 6, md: 9 } }}>
       <SectionHeading headingLevel={1}
        eyebrow={`${balances.points} points · ${balances.stars} stars`}
        title="Your activity"
        description="Every point comes from a ledger entry. Corrections add a compensating entry rather than erasing history."
      />

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h5" sx={{ mb: 2 }}>
                Attendance
              </Typography>
              {attendance.length === 0 ? (
                <EmptyState
                  title="No attendance yet"
                  description="Your first confirmed check-in and check-out will show up here."
                  action={
                    <Button component="a" href="/events" variant="outlined">
                      Find an event
                    </Button>
                  }
                />
              ) : (
                <Stack spacing={2} divider={<Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }} />}>
                  {attendance.map((row) => (
                    <Stack key={row.id} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 650 }}>
                          {row.eventName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDateTime(row.checkedInAt)}
                          {row.checkedOutAt ? ` → ${formatDateTime(row.checkedOutAt)}` : ' → no check-out'}
                          {row.durationMinutes !== null ? ` · ${row.durationMinutes} min` : ''}
                          {row.sessionKind === 'bonus' ? ' · bonus session' : ''}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        {row.qualified ? (
                          <Chip size="small" color="warning" label={`+${row.rewardPoints} pts`} />
                        ) : (
                          <StatusChip status={row.state} />
                        )}
                      </Stack>
                    </Stack>
                  ))}
                </Stack>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2.5 }}>
                Missing checkout or a threshold error? Email gdg@psu.edu from your registered address —
                organizers can correct attendance with an audited reason.
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h5" sx={{ mb: 2 }}>
                Points ledger
              </Typography>
              {ledger.length === 0 ? (
                <EmptyState title="No ledger entries yet" />
              ) : (
                <Stack spacing={1.5} divider={<Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }} />}>
                  {ledger.map((row) => (
                    <Stack key={row.id} direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle2">{row.description}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {kindLabels[row.kind] ?? row.kind} · {formatDateTime(row.createdAt)}
                        </Typography>
                      </Box>
                      <Typography
                        variant="subtitle2"
                        sx={{
                          fontVariantNumeric: 'tabular-nums',
                          color: row.delta > 0 ? 'success.main' : 'text.primary',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {row.delta > 0 ? '+' : ''}
                        {row.delta}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
