import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Gift,
  MapPin,
  Nfc,
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
  title: 'My dashboard',
  robots: { index: false, follow: false },
};

export default async function MemberDashboard({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { member, supabase, user } = await requireMember();
  const { welcome } = await searchParams;

  const [balances, attendance, ledger, card, nextEvent] = await Promise.all([
    getBalances(supabase, member.id),
    getRecentAttendance(supabase, member.id, 4),
    getLedger(supabase, member.id, 4),
    getCardStatus(supabase, member.id),
    supabase
      .from('events')
      .select('name, slug, starts_at, location')
      .eq('status', 'published')
      .gte('ends_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const attendedCount = attendance.filter((row) => row.qualified).length;
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
          className="mb-6 flex items-start gap-3 overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#132a6b_0%,#16357a_50%,#0b4a45_100%)] px-5 py-4 text-white shadow-glow"
        >
          <Sparkles className="mt-0.5 size-5 shrink-0 text-white/80" aria-hidden />
          <div>
            <p className="text-base font-bold">
              You&apos;re in, {member.displayName.split(' ')[0]}.
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-white/80">
              Your permanent profile is live at /m/{member.slug}. Your card will appear here once an
              organizer writes it.
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
            <Link
              href={`/m/${member.slug}`}
              className={buttonVariants({
                variant: 'secondary',
                size: 'sm',
                className: 'self-start sm:self-auto',
              })}
            >
              View public profile
            </Link>
          </div>

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
              label="Qualified sessions"
              value={attendedCount}
              hint="Recent sessions shown"
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
                  description="Tap in with an organizer, stay for the session, then check out. Points land after both confirmations."
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
                        <span className="shrink-0 rounded-full border border-star/25 bg-star/10 px-2.5 py-0.5 text-[0.72rem] font-bold tabular-nums text-star">
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
                <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary">
                  <Nfc className="size-4" aria-hidden />
                </span>
                <h2 className="text-base font-bold">Your card</h2>
              </div>
              <StatusChip status={cardTone} label={cardLabel} />
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {card.status === 'active'
                  ? 'Tap your card at any organizer kiosk. The card only opens your profile — staff still confirm attendance.'
                  : card.status === 'pending'
                    ? 'An organizer has queued your card. Bring it to the next event to be written.'
                    : card.status === 'lost'
                      ? 'This card is marked lost. Use your digital ID and ask an organizer for a replacement.'
                      : card.status === 'replaced' || card.status === 'revoked'
                        ? 'This card is no longer active. Use your digital ID or ask an organizer for a new card.'
                        : 'Your digital ID works now. Ask an organizer to write a physical card at the next event.'}
              </p>
              <Link href="/member/id" className={buttonVariants({ className: 'mt-4 w-full' })}>
                Show digital ID
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <h2 className="mb-2 text-base font-bold">Next up</h2>
              {nextEvent.data ? (
                <>
                  <p className="text-sm font-semibold">{nextEvent.data.name}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {formatDateTime(nextEvent.data.starts_at)}
                    {nextEvent.data.location ? (
                      <span className="mt-1 flex items-center gap-1.5 text-xs">
                        <MapPin className="size-3.5" aria-hidden />
                        {nextEvent.data.location}
                      </span>
                    ) : null}
                  </p>
                  <Link
                    href={`/events/${nextEvent.data.slug}`}
                    className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    Event details
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  No published events right now. Check back soon.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg bg-secondary/10 text-secondary">
                  <Gift className="size-4" aria-hidden />
                </span>
                <h2 className="text-base font-bold">Redeem points</h2>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Merch and perks from the GDG@PSU shelf. Stars stay untouched when you spend.
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
