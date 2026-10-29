import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import RedeemOutlinedIcon from '@mui/icons-material/RedeemOutlined';
import { EmptyState, SectionHeading, StatusChip } from '@gdg/ui';
import { requireMember } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { getBalances } from '@/lib/member/queries';
import { formatDateTime } from '@/lib/format';
import { RewardCard } from '@/components/member/reward-card';
import { cancelRedemptionAction } from '@/app/(member)/member/actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Rewards',
  robots: { index: false, follow: false },
};

export default async function RewardsPage() {
  const { member, supabase, user } = await requireMember();
  const admin = createSupabaseAdmin();
  const [balances, rewardsResult, redemptionsResult] = await Promise.all([
    getBalances(supabase, member.id),
    admin
      .from('rewards')
      .select('id, name, description, cost_points, inventory, fulfillment_note')
      .eq('is_active', true)
      .order('cost_points', { ascending: true }),
    admin
      .from('redemptions')
      .select('id, reward_name_snapshot, quantity, points_debited, status, created_at, reason')
      .eq('member_id', member.id)
      .order('created_at', { ascending: false })
      .limit(12),
  ]);

  const rewards = rewardsResult.data ?? [];
  const redemptions = redemptionsResult.data ?? [];

  return (
    <Container maxWidth="lg" sx={{ pb: { xs: 6, md: 9 } }}>
      <SectionHeading
        headingLevel={1}
        eyebrow={`${balances.points} points available · ${balances.stars} stars untouched`}
        title="The rewards shelf"
        description="Points are reserved when you request an item. Cancellations return them through an audited ledger entry; stars never change when you spend."
      />

      {rewards.length === 0 ? (
        <EmptyState
          title="The shelf is empty"
          description="Organizers will add merchandise and perks here. Your points keep accumulating."
          icon={<RedeemOutlinedIcon fontSize="large" />}
        />
      ) : (
        <Grid container spacing={2.5}>
          {rewards.map((reward) => (
            <Grid key={reward.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <RewardCard
                id={reward.id as string}
                name={reward.name as string}
                description={(reward.description as string) ?? ''}
                costPoints={reward.cost_points as number}
                inventory={(reward.inventory as number | null) ?? null}
                fulfillmentNote={(reward.fulfillment_note as string) ?? ''}
                balance={balances.points}
              />
            </Grid>
          ))}
        </Grid>
      )}

      <Box sx={{ mt: 6 }}>
        <Typography variant="h3" sx={{ mb: 2 }}>
          Your requests
        </Typography>
        {redemptions.length === 0 ? (
          <EmptyState
            title="No requests yet"
            description="Anything you redeem will be tracked here."
          />
        ) : (
          <Stack spacing={1.5}>
            {redemptions.map((row) => (
              <Card key={row.id as string}>
                <CardContent sx={{ p: 2.5 }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={2}
                    sx={{ alignItems: { sm: 'center' } }}
                  >
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 650 }}>
                        {row.reward_name_snapshot as string}
                        {Number(row.quantity) > 1 ? ` × ${row.quantity}` : ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatDateTime(row.created_at as string)} · {row.points_debited as number}{' '}
                        points
                        {row.reason ? ` · ${row.reason as string}` : ''}
                      </Typography>
                    </Box>
                    <StatusChip status={row.status as string} />
                    {['requested', 'approved'].includes(row.status as string) ? (
                      <Box component="form" action={cancelRedemptionAction}>
                        <input type="hidden" name="redemptionId" value={row.id as string} />
                        <Chip
                          component="button"
                          type="submit"
                          label="Cancel"
                          variant="outlined"
                          clickable
                          aria-label={`Cancel request for ${row.reward_name_snapshot as string}`}
                        />
                      </Box>
                    ) : null}
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 4 }}>
        Signed in as {user.email}. Redemption requests are reviewed by an organizer at the next
        event.
      </Typography>
    </Container>
  );
}
