import type { Metadata } from 'next';
import Link from 'next/link';
import {
  buttonVariants,
  Card,
  CardContent,
  EmptyState,
  Input,
  PageShell,
  StatusChip,
} from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';
import { RewardForm } from '@/components/admin/reward-form';
import { decideRedemptionAction, deleteRecordAction } from '@/app/(admin)/admin/actions';
import { Flash, SubmitButton } from '@/components/admin/ui';
import { ConfirmAction } from '@/components/admin/confirm-action';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Rewards',
  robots: { index: false, follow: false },
};

const REQUEST_COLUMNS =
  'id, reward_name_snapshot, quantity, points_debited, status, created_at, decided_at, fulfilled_at, reason, members(public_number, member_profiles(display_name))';

const STATUS_LABELS: Record<string, string> = {
  requested: 'Waiting',
  approved: 'Approved',
  fulfilled: 'Handed over',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

type RequestRow = {
  id: string;
  title: string;
  number: string;
  points: number;
  status: string;
  createdAt: string;
  handledAt: string | null;
  reason: string | null;
};

function toRequest(row: Record<string, unknown>): RequestRow {
  const member = (Array.isArray(row.members) ? row.members[0] : row.members) as
    { public_number?: string; member_profiles?: unknown } | undefined;
  const profile = (
    Array.isArray(member?.member_profiles) ? member.member_profiles[0] : member?.member_profiles
  ) as { display_name?: string } | undefined;
  const quantity = Number(row.quantity) > 1 ? ` × ${row.quantity as number}` : '';
  return {
    id: row.id as string,
    title: `${profile?.display_name ?? 'Member'} — ${row.reward_name_snapshot as string}${quantity}`,
    number: member?.public_number ?? '',
    points: row.points_debited as number,
    status: row.status as string,
    createdAt: row.created_at as string,
    handledAt: ((row.fulfilled_at ?? row.decided_at) as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
  };
}

function Decision({
  id,
  action,
  label,
  returnTo,
}: {
  id: string;
  action: 'approve' | 'fulfil';
  label: string;
  returnTo: string;
}) {
  return (
    <form action={decideRedemptionAction}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="redemptionId" value={id} />
      <input type="hidden" name="action" value={action} />
      <SubmitButton size="small" pendingLabel="Saving…">
        {label}
      </SubmitButton>
    </form>
  );
}

/** Turning a request down gives the points back, so it asks why first. */
function Refusal({
  id,
  action,
  label,
  returnTo,
}: {
  id: string;
  action: 'reject' | 'cancel';
  label: string;
  returnTo: string;
}) {
  return (
    <details className="w-full sm:w-auto">
      <summary className="cursor-pointer text-sm font-medium text-danger">{label}</summary>
      <form action={decideRedemptionAction} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="redemptionId" value={id} />
        <input type="hidden" name="action" value={action} />
        <Input
          name="reason"
          aria-label="Reason the member will see"
          placeholder="Reason the member will see"
          required
          minLength={3}
          maxLength={300}
          className="h-9 min-w-[12rem] flex-1 text-xs"
        />
        <SubmitButton size="small" variant="outlined" color="error" pendingLabel="Saving…">
          {label} and refund
        </SubmitButton>
      </form>
    </details>
  );
}

export default async function AdminRewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const viewer = await requireAdmin();
  const { notice, error } = await searchParams;
  const admin = createSupabaseAdmin();
  const returnTo = '/admin/rewards';

  const [rewards, waiting, handled] = await Promise.all([
    admin
      .from('rewards')
      .select('id, name, description, cost_points, inventory, is_active')
      .order('created_at', { ascending: false }),
    admin
      .from('redemptions')
      .select(REQUEST_COLUMNS)
      .in('status', ['requested', 'approved'])
      .order('created_at', { ascending: true })
      .limit(50),
    admin
      .from('redemptions')
      .select(REQUEST_COLUMNS)
      .in('status', ['fulfilled', 'rejected', 'cancelled'])
      .order('updated_at', { ascending: false })
      .limit(20),
  ]);
  const open = (waiting.data ?? []).map(toRequest);
  const done = (handled.data ?? []).map(toRequest);

  return (
    <PageShell>
      <Flash notice={notice} error={error} />

      <div className="grid gap-8 lg:grid-cols-[1.55fr_1fr] lg:items-start">
        <div>
          <div className="mb-6">
            <p className="type-overline text-primary">Rewards</p>
            <h1 className="type-h1 mt-2">Rewards</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              What members can spend their points on. Stars are never spent.
            </p>
          </div>

          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="type-h3">Requests waiting</h2>
            <span className="text-xs text-muted-foreground">{open.length} open</span>
          </div>
          {open.length === 0 ? (
            <EmptyState
              title="Nothing waiting"
              description="When a member asks for a reward, it appears here."
            />
          ) : (
            <ul className="space-y-2.5" aria-label="Requests waiting">
              {open.map((row) => (
                <li key={row.id}>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[0.95rem] font-semibold leading-snug">{row.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            <span className="font-mono">{row.number}</span> ·{' '}
                            <span className="font-mono tabular-nums">{row.points}</span> points ·{' '}
                            {formatDateTime(row.createdAt)}
                          </p>
                        </div>
                        <StatusChip status={row.status} label={STATUS_LABELS[row.status]} />
                      </div>

                      <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-border pt-3">
                        {row.status === 'requested' ? (
                          <>
                            <Decision
                              id={row.id}
                              action="approve"
                              label="Approve"
                              returnTo={returnTo}
                            />
                            <Refusal
                              id={row.id}
                              action="reject"
                              label="Reject"
                              returnTo={returnTo}
                            />
                          </>
                        ) : (
                          <>
                            <Decision
                              id={row.id}
                              action="fulfil"
                              label="Handed over"
                              returnTo={returnTo}
                            />
                            <Refusal
                              id={row.id}
                              action="cancel"
                              label="Cancel"
                              returnTo={returnTo}
                            />
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}

          <h2 className="type-h3 mb-3 mt-8">What members can get</h2>
          {!rewards.data || rewards.data.length === 0 ? (
            <EmptyState title="No rewards yet" description="Add something members can ask for." />
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
                          label={reward.is_active ? 'On offer' : 'Hidden'}
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

          {done.length > 0 ? (
            <>
              <h2 className="type-h3 mb-3 mt-8">Recently handled</h2>
              <ul
                className="divide-y divide-border border border-border"
                aria-label="Recently handled"
              >
                {done.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">{row.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {row.points} points
                        {row.handledAt ? ` · ${formatDateTime(row.handledAt)}` : ''}
                        {row.reason ? ` · ${row.reason}` : ''}
                      </p>
                    </div>
                    <StatusChip status={row.status} label={STATUS_LABELS[row.status]} />
                    {viewer.isSuperadmin ? (
                      <ConfirmAction
                        action={deleteRecordAction}
                        fields={{ kind: 'redemption', id: row.id, returnTo }}
                        label="Delete"
                        variant="ghost"
                        destructive
                        title="Delete this request for good?"
                        description={`${row.title}. It is removed from this list and from the member's rewards page. Their points are not changed.`}
                        confirmLabel="Yes, delete it for good"
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <Card className="lg:sticky lg:top-24">
          <CardContent className="pt-5">
            <h2 className="type-h3">New reward</h2>
            <p className="mb-4 mt-1 text-xs text-muted-foreground">
              Members can ask for it as soon as it is saved.
            </p>
            <RewardForm returnTo={returnTo} />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
