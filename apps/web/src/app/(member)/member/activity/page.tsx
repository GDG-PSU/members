import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  buttonVariants,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  PageShell,
  SectionHeading,
  StatusChip,
} from '@gdg/ui';
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
    <PageShell width="lg" className="pb-10 pt-6 sm:pt-8">
      <SectionHeading
        headingLevel={1}
        eyebrow={`${balances.points} points · ${balances.stars} stars`}
        title="Your activity"
        description="Every point is a ledger entry. Corrections add one; nothing is erased."
      />

      <div className="grid gap-5 md:grid-cols-[1.45fr_1fr]">
        <Card className="min-w-0">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-5 pb-2 sm:p-6 sm:pb-2">
            <h2 className="text-base font-bold">Attendance</h2>
            <Badge variant="neutral" className="tabular-nums">
              {attendance.length}
            </Badge>
          </CardHeader>
          <CardContent className="p-5 pt-0 sm:p-6 sm:pt-0">
            {attendance.length === 0 ? (
              <EmptyState
                title="No attendance yet"
                description="Your first confirmed check-in and check-out will show up here."
                action={
                  <Link href="/events" className={buttonVariants({ variant: 'secondary' })}>
                    Find an event
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {attendance.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{row.eventName}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {formatDateTime(row.checkedInAt)}
                        {row.checkedOutAt
                          ? ` → ${formatDateTime(row.checkedOutAt)}`
                          : ' → no check-out'}
                        {row.durationMinutes !== null ? ` · ${row.durationMinutes} min` : ''}
                        {row.sessionKind === 'bonus' ? ' · bonus session' : ''}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {row.qualified ? (
                        <Badge variant="star" className="tabular-nums">
                          +{row.rewardPoints} pts
                        </Badge>
                      ) : (
                        <StatusChip status={row.state} />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Missing check-out? Email gdg@psu.edu and an organizer can review it.
            </p>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="p-5 pb-2 sm:p-6 sm:pb-2">
            <h2 className="text-base font-bold">Points ledger</h2>
          </CardHeader>
          <CardContent className="p-5 pt-0 sm:p-6 sm:pt-0">
            {ledger.length === 0 ? (
              <EmptyState title="No ledger entries yet" />
            ) : (
              <ul className="divide-y divide-border">
                {ledger.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug">{row.description}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {kindLabels[row.kind] ?? row.kind} · {formatDateTime(row.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 whitespace-nowrap text-sm font-bold tabular-nums ${
                        row.delta > 0 ? 'text-success' : 'text-foreground'
                      }`}
                    >
                      {row.delta > 0 ? '+' : ''}
                      {row.delta}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
