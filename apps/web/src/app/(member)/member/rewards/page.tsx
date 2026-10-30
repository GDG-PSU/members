import type { Metadata } from 'next';
import { Gift } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageShell,
  SectionHeading,
  StatusChip,
} from '@gdg/ui';
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
    <PageShell width="lg" className="pb-10 pt-6 sm:pt-8">
      <SectionHeading
        headingLevel={1}
        eyebrow={`${balances.points} points available · ${balances.stars} stars untouched`}
        title="The rewards shelf"
        description="Points are reserved on request and refunded if cancelled. Stars never change."
      />

      {rewards.length === 0 ? (
        <EmptyState
          title="The shelf is empty"
          description="Organizers will stock it soon."
          icon={<Gift />}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rewards.map((reward) => (
            <RewardCard
              key={reward.id}
              id={reward.id as string}
              name={reward.name as string}
              description={(reward.description as string) ?? ''}
              costPoints={reward.cost_points as number}
              inventory={(reward.inventory as number | null) ?? null}
              fulfillmentNote={(reward.fulfillment_note as string) ?? ''}
              balance={balances.points}
            />
          ))}
        </div>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="type-h3">Your requests</h2>
          {redemptions.length > 0 ? (
            <Badge variant="neutral" className="tabular-nums">
              {redemptions.length}
            </Badge>
          ) : null}
        </div>

        {redemptions.length === 0 ? (
          <EmptyState title="No requests yet" description="Your requests will show up here." />
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {redemptions.map((row) => (
                  <li
                    key={row.id as string}
                    className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">
                        {row.reward_name_snapshot as string}
                        {Number(row.quantity) > 1 ? ` × ${row.quantity}` : ''}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {formatDateTime(row.created_at as string)} · {row.points_debited as number}{' '}
                        points
                        {row.reason ? ` · ${row.reason as string}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusChip status={row.status as string} />
                      {['requested', 'approved'].includes(row.status as string) ? (
                        <form action={cancelRedemptionAction}>
                          <input type="hidden" name="redemptionId" value={row.id as string} />
                          <Button
                            type="submit"
                            variant="secondary"
                            size="sm"
                            aria-label={`Cancel request for ${row.reward_name_snapshot as string}`}
                          >
                            Cancel
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Signed in as {user.email}. Requests are reviewed at the next event.
      </p>
    </PageShell>
  );
}
