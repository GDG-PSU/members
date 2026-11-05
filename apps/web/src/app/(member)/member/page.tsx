import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Gift,
  Nfc,
  QrCode,
  Sparkles,
  Star,
  Trophy,
} from 'lucide-react';
import {
  buttonVariants,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  MemberAvatar,
  MetricCard,
  PageShell,
  StatusChip,
} from '@gdg/ui';
import { requireMember } from '@/lib/auth/viewer';
import { getBalances, getCardStatus, getRecentAttendance, getLedger } from '@/lib/member/queries';
import { profilePhotoUrl } from '@/lib/profile/photo';
import { formatDate, formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Home',
  robots: { index: false, follow: false },
};

export default async function MemberDashboard({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { member, supabase, user } = await requireMember();
  const { welcome } = await searchParams;

  const [balances, attendance, ledger, card, qualified, nextEvent] = await Promise.all([
    getBalances(supabase, member.id),
    getRecentAttendance(supabase, member.id, 4),
    getLedger(supabase, member.id, 4),
    getCardStatus(supabase, member.id),
    // Counted in the database: the list above only holds the latest few rows.
    supabase
      .from('attendance_records')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', member.id)
      .eq('qualified', true),
    supabase
      .from('events')
      .select('name, slug, starts_at, location')
      .eq('status', 'published')
      .gte('ends_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const attendedCount = qualified.count ?? 0;
  const cardLabel =
    card.status === 'active'
      ? 'Active'
      : card.status === 'pending'
        ? 'Awaiting write'
        : card.status === 'none'
          ? 'No card yet'
          : card.status === 'lost'
            ? 'Reported lost'
            : card.status === 'replaced'
              ? 'Replaced'
              : 'Inactive';
  const cardTone =
    card.status === 'active'
      ? 'active'
      : card.status === 'pending'
        ? 'pending'
        : card.status === 'lost'
          ? 'suspended'
          : 'draft';

  return (
    <PageShell width="lg" className="pb-10 pt-6 sm:pt-8">
      {welcome ? (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 border border-border bg-[#161616] px-4 py-3 text-white"
        >
          <Sparkles className="mt-0.5 size-5 shrink-0 text-white/80" aria-hidden />
          <div>
            <p className="text-base font-bold">
              You&apos;re in, {member.displayName.split(' ')[0]}.
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-white/80">
              Your profile is live at /m/{member.slug}. Your card comes at the next event.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.65fr_1fr]">
        <div className="min-w-0 space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <MemberAvatar
              name={member.displayName}
              photoUrl={profilePhotoUrl(member.slug)}
              size={72}
            />
            <div className="min-w-0 flex-1">
              <p className="type-overline text-muted-foreground">
                Member since {formatDate(member.memberSince)}
              </p>
              <h1 className="type-h2 mt-1">{member.displayName}</h1>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {member.publicNumber} · {user.email}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 self-start sm:self-auto">
              <Link href="/member/id" className={buttonVariants({ size: 'sm' })}>
                <QrCode className="size-4" aria-hidden />
                Show my ID
              </Link>
              <Link
                href={`/m/${member.slug}`}
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                View public profile
              </Link>
            </div>
          </div>

          {nextEvent.data ? (
            <Link
              href={`/events/${nextEvent.data.slug}`}
              className="flex items-center gap-4 border border-border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <span className="grid size-10 shrink-0 place-items-center bg-primary-soft text-primary">
                <CalendarDays className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="type-overline block text-muted-foreground">Next event</span>
                <span className="mt-0.5 block truncate text-base font-bold">
                  {nextEvent.data.name}
                </span>
                <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">
                  {formatDateTime(nextEvent.data.starts_at)}
                  {nextEvent.data.location ? ` · ${nextEvent.data.location}` : ''}
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              label="Spendable points"
              value={balances.points}
              hint="Use these on rewards"
              icon={<Trophy />}
            />
            <MetricCard
              label="Lifetime stars"
              value={balances.stars}
              hint="Never spent"
              icon={<Star />}
            />
            <MetricCard
              label="Sessions that earned points"
              value={attendedCount}
              hint="All time"
              icon={<BadgeCheck />}
            />
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-5 pb-3 sm:p-6 sm:pb-3">
              <h2 className="text-base font-bold">Recent activity</h2>
              <Link
                href="/member/activity"
                className={buttonVariants({ variant: 'ghost', size: 'sm' })}
              >
                All activity
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </CardHeader>
            <CardContent>
              {attendance.length === 0 && ledger.length === 0 ? (
                <EmptyState
                  title="Your history starts at the next event"
                  description="Check in and out at the next event to earn points."
                  icon={<CalendarDays />}
                />
              ) : (
                <ul className="divide-y divide-border">
                  {attendance.slice(0, 2).map((row) => (
                    <li key={row.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{row.eventName}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {formatDateTime(row.checkedInAt)} · {row.sessionName}
                          {row.sessionKind === 'bonus' ? ' (bonus)' : ''}
                        </p>
                      </div>
                      {row.qualified ? (
                        <span className="shrink-0 bg-star/15 px-2 py-0.5 text-xs tabular-nums text-star">
                          +{row.rewardPoints} pts
                        </span>
                      ) : (
                        <StatusChip status={row.state} />
                      )}
                    </li>
                  ))}
                  {ledger.slice(0, 2).map((row) => (
                    <li
                      key={`ledger-${row.id}`}
                      className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{row.description}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatDateTime(row.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-sm font-bold tabular-nums ${
                          row.delta > 0 ? 'text-success' : 'text-muted-foreground'
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

        <aside className="min-w-0 space-y-4">
          <Card>
            <CardContent className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid size-8 place-items-center bg-primary-soft text-primary">
                  <Nfc className="size-4" aria-hidden />
                </span>
                <h2 className="text-base font-bold">Your card</h2>
              </div>
              <StatusChip status={cardTone} label={cardLabel} />
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {card.status === 'active'
                  ? 'Tap at any kiosk. Staff still confirm attendance.'
                  : card.status === 'pending'
                    ? 'Bring it to the next event to be written.'
                    : card.status === 'lost'
                      ? 'Marked lost. Ask an organizer for a replacement.'
                      : card.status === 'replaced' || card.status === 'revoked'
                        ? 'Inactive. Use your digital ID or ask for a new card.'
                        : 'Ask an organizer to write your card.'}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                No card with you? Show my ID works the same way at check-in.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid size-8 place-items-center bg-layer-accent text-foreground">
                  <Gift className="size-4" aria-hidden />
                </span>
                <h2 className="text-base font-bold">Redeem points</h2>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Merch and perks. Stars never get spent.
              </p>
              <Link
                href="/member/rewards"
                className={buttonVariants({ variant: 'secondary', className: 'mt-4 w-full' })}
              >
                Browse rewards
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>
    </PageShell>
  );
}
