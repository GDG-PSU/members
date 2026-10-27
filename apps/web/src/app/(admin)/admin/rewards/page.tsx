import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { EmptyState, StatusChip } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';
import { RewardForm } from '@/components/admin/reward-form';
import { decideRedemptionAction } from '@/app/(admin)/admin/actions';
import { Flash, SubmitButton } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Rewards',
  robots: { index: false, follow: false },
};

export default async function AdminRewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  await requireAdmin();
  const { notice, error } = await searchParams;
  const admin = createSupabaseAdmin();
  const returnTo = '/admin/rewards';

  const [rewards, redemptions] = await Promise.all([
    admin.from('rewards').select('id, name, description, cost_points, inventory, is_active').order('created_at', { ascending: false }),
    admin
      .from('redemptions')
      .select('id, reward_name_snapshot, quantity, points_debited, status, created_at, reason, members(public_number, member_profiles(display_name))')
      .in('status', ['requested', 'approved'])
      .order('created_at', { ascending: true })
      .limit(50),
  ]);

  return (
    <Container maxWidth="xl" sx={{ pb: 8 }}>
      <Flash notice={notice} error={error} />
      <Grid container spacing={4}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Typography variant="overline" color="primary">
            Catalogue
          </Typography>
          <Typography variant="h2" component="h1" sx={{ mb: 2, fontSize: { xs: '2rem', md: '2.5rem' } }}>
            Rewards
          </Typography>
          {!rewards.data || rewards.data.length === 0 ? (
            <EmptyState title="No rewards yet" description="Add merchandise or perks for members to redeem." />
          ) : (
            <Stack spacing={1.5}>
              {rewards.data.map((reward) => (
                <Card key={reward.id as string}>
                  <CardContent sx={{ p: 2.5 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="h5">{reward.name as string}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {reward.cost_points as number} points ·{' '}
                          {reward.inventory === null ? 'unlimited' : `${reward.inventory as number} in stock`}
                        </Typography>
                      </Box>
                      <StatusChip status={reward.is_active ? 'active' : 'revoked'} label={reward.is_active ? 'active' : 'inactive'} />
                      <Button component="a" href={`/admin/rewards/${reward.id}`} size="small">
                        Edit
                      </Button>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}

          <Typography variant="h4" sx={{ mt: 4, mb: 2 }}>
            Redemption queue
          </Typography>
          {!redemptions.data || redemptions.data.length === 0 ? (
            <EmptyState title="Nothing waiting" description="Member requests appear here for approval." />
          ) : (
            <Stack spacing={1.5} divider={<Divider flexItem />}>
              {redemptions.data.map((row) => {
                const member = Array.isArray(row.members) ? row.members[0] : row.members;
                const profile = Array.isArray(member?.member_profiles)
                  ? member.member_profiles[0]
                  : member?.member_profiles;
                return (
                  <Card key={row.id as string}>
                    <CardContent sx={{ p: 2.5 }}>
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 650 }}>
                            {(profile?.display_name as string) ?? 'Member'} — {row.reward_name_snapshot as string}
                            {Number(row.quantity) > 1 ? ` × ${row.quantity}` : ''}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {member?.public_number as string} · {row.points_debited as number} points ·{' '}
                            {formatDateTime(row.created_at as string)}
                          </Typography>
                        </Box>
                        <StatusChip status={row.status as string} />
                        <Box component="form" action={decideRedemptionAction} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="redemptionId" value={row.id as string} />
                          <TextField name="reason" size="small" label="Reason (for reject)" slotProps={{ htmlInput: { maxLength: 300 } }} />
                          <TextField select name="action" size="small" label="Action" defaultValue={row.status === 'approved' ? 'fulfil' : 'approve'} sx={{ minWidth: 120 }}>
                            {[
                              { value: 'approve', label: 'Approve' },
                              { value: 'fulfil', label: 'Fulfil' },
                              { value: 'reject', label: 'Reject' },
                              { value: 'cancel', label: 'Cancel' },
                            ].map((option) => (
                              <MenuItem key={option.value} value={option.value}>
                                {option.label}
                              </MenuItem>
                            ))}
                          </TextField>
                          <SubmitButton size="small" variant="outlined" pendingLabel="Saving…" confirmMessage="Apply this redemption action?">
                            Apply
                          </SubmitButton>
                        </Box>
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
                New reward
              </Typography>
              <RewardForm returnTo={returnTo} />
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
