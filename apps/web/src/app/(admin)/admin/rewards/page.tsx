import type { Metadata } from 'next';
import Link from 'next/link';
import {
  buttonVariants,
  Card,
  CardContent,
  EmptyState,
  Input,
  PageShell,
  Select,
  StatusChip,
} from '@gdg/ui';
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

const decisions = [
  { value: 'approve', label: 'Approve' },
  { value: 'fulfil', label: 'Fulfil' },
  { value: 'reject', label: 'Reject' },
  { value: 'cancel', label: 'Cancel' },
];

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
    admin
      .from('rewards')
      .select('id, name, description, cost_points, inventory, is_active')
      .order('created_at', { ascending: false }),
    admin
      .from('redemptions')
      .select(
        'id, reward_name_snapshot, quantity, points_debited, status, created_at, reason, members(public_number, member_profiles(display_name))',
      )
      .in('status', ['requested', 'approved'])
      .order('created_at', { ascending: true })
      .limit(50),
  ]);

  return (
    <PageShell>
      <Flash notice={notice} error={error} />

      <div className="grid gap-8 lg:grid-cols-[1.55fr_1fr] lg:items-start">
        <div>
          <div className="mb-6">
            <p className="type-overline text-primary">Catalogue</p>
            <h1 className="type-h1 mt-2">Rewards</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Points members can spend — stars are never spent.
            </p>
          </div>

          {!rewards.data || rewards.data.length === 0 ? (
            <EmptyState title="No rewards yet" description="Add something members can redeem." />
          ) : (
            <ul className="space-y-2.5">
              {rewards.data.map((reward) => (
                <li key={reward.id as string}>
                  <Card className="transition-colors hover:border-primary/35">
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[0.95rem] font-bold">
                            {reward.name as string}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            <span className="font-mono tabular-nums">
                              {reward.cost_points as number}
                            </span>{' '}
                            points ·{' '}
                            {reward.inventory === null
                              ? 'unlimited'
                              : `${reward.inventory as number} in stock`}
                          </p>
                        </div>
                        <StatusChip
                          status={reward.is_active ? 'active' : 'revoked'}
                          label={reward.is_active ? 'active' : 'inactive'}
                        />
                        <Link
                          href={`/admin/rewards/${reward.id}`}
                          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                        >
                          Edit
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}

          <div className="mb-3 mt-8 flex items-baseline justify-between">
            <h2 className="type-h3">Redemption queue</h2>
            <span className="text-xs text-muted-foreground">
              {(redemptions.data ?? []).length} open
            </span>
          </div>

          {!redemptions.data || redemptions.data.length === 0 ? (
            <EmptyState title="Nothing waiting" description="Requests appear here for approval." />
          ) : (
            <ul className="space-y-2.5">
              {redemptions.data.map((row) => {
                const member = Array.isArray(row.members) ? row.members[0] : row.members;
                const profile = Array.isArray(member?.member_profiles)
                  ? member.member_profiles[0]
                  : member?.member_profiles;
                return (
                  <li key={row.id as string}>
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex flex-wrap items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-[0.95rem] font-semibold leading-snug">
                              {(profile?.display_name as string) ?? 'Member'} —{' '}
                              {row.reward_name_snapshot as string}
                              {Number(row.quantity) > 1 ? ` × ${row.quantity}` : ''}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              <span className="font-mono">{member?.public_number as string}</span> ·{' '}
                              <span className="font-mono tabular-nums">
                                {row.points_debited as number}
                              </span>{' '}
                              points · {formatDateTime(row.created_at as string)}
                            </p>
                          </div>
                          <StatusChip status={row.status as string} />
                        </div>

                        <form
                          action={decideRedemptionAction}
                          className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3"
                        >
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="redemptionId" value={row.id as string} />
                          <Input
                            name="reason"
                            aria-label="Reason (for reject)"
                            placeholder="Reason (for reject)"
                            maxLength={300}
                            className="h-9 min-w-[11rem] flex-1 text-xs"
                          />
                          <Select
                            name="action"
                            aria-label="Redemption action"
                            defaultValue={row.status === 'approved' ? 'fulfil' : 'approve'}
                            className="h-9 w-[8.5rem] text-xs"
                          >
                            {decisions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </Select>
                          <SubmitButton
                            pendingLabel="Saving…"
                            confirmMessage="Apply this redemption action?"
                          >
                            Apply
                          </SubmitButton>
                        </form>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Card className="lg:sticky lg:top-24">
          <CardContent className="pt-5">
            <h2 className="type-h3">New reward</h2>
            <p className="mb-4 mt-1 text-xs text-muted-foreground">Active by default.</p>
            <RewardForm returnTo={returnTo} />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
