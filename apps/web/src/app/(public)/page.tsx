import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  MapPin,
  Nfc,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
} from 'lucide-react';
import {
  buttonVariants,
  Card,
  CardContent,
  EmptyState,
  MemberAvatar,
  SectionHeading,
} from '@gdg/ui';
import { listLeaderboard, listPublicEvents } from '@/lib/public/queries';
import { getViewer } from '@/lib/auth/viewer';
import { formatDate, formatTime } from '@/lib/format';
import { SUPPORT_EMAIL } from '@/lib/env';

export const dynamic = 'force-dynamic';

const features = [
  {
    icon: Nfc,
    title: 'Your card is a doorway',
    body: 'A tap opens your permanent profile. It never authorizes a check-in, a purchase or an account action.',
  },
  {
    icon: Star,
    title: 'Stars are forever',
    body: 'Every point you earn also becomes a star. Spend points on merch; stars stay as a record of showing up.',
  },
  {
    icon: ShieldCheck,
    title: 'No silent awards',
    body: 'An organizer confirms check-in and check-out. Miss a checkout and no attendance points are granted.',
  },
];

export default async function HomePage() {
  const viewer = await getViewer().catch(() => null);
  const dashboard = viewer?.member
    ? { href: '/member', label: 'My dashboard' }
    : viewer?.isAdmin
      ? { href: '/admin', label: 'Open admin' }
      : viewer?.user
        ? { href: '/invite/accept', label: 'Finish setup' }
        : null;

  const [leaders, events] = await Promise.all([
    listLeaderboard(5, 0).catch(() => []),
    listPublicEvents(3).catch(() => []),
  ]);
  const podium = leaders.slice(0, 3);

  return (
    <>
      <section className="relative overflow-hidden border-b border-border">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-40" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-aurora" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent,var(--background))]"
        />

        <div className="relative mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
            <div className="animate-rise">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1 text-xs font-semibold text-muted-foreground shadow-card backdrop-blur">
                <Sparkles className="size-3.5 text-primary" aria-hidden />
                Your GDG@PSU member pass
              </span>

              <h1 className="type-display mt-5 max-w-[16ch]">
                Build things.
                <br />
                <span className="bg-gradient-to-r from-primary via-brand-blue to-secondary bg-clip-text text-transparent">
                  Belong here.
                </span>
              </h1>

              <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
                One card. One profile. Every event, workshop and late-night build counted — for the
                people who show up and make GDG@PSU what it is.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/events" className={buttonVariants({ size: 'lg' })}>
                  See what&apos;s next
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                {dashboard ? (
                  <Link
                    href={dashboard.href}
                    className={buttonVariants({ variant: 'secondary', size: 'lg' })}
                  >
                    {dashboard.label}
                  </Link>
                ) : (
                  <Link
                    href="/login"
                    className={buttonVariants({ variant: 'secondary', size: 'lg' })}
                  >
                    Sign in
                  </Link>
                )}
              </div>

              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                Membership is by invitation after dues are recorded. Questions? {SUPPORT_EMAIL}
              </p>
            </div>

            <div className="relative animate-rise lg:animate-fade">
              <div
                aria-hidden
                className="absolute -inset-6 rounded-[3rem] bg-gradient-to-tr from-brand-blue/25 via-transparent to-brand-green/20 blur-3xl"
              />
              <div className="relative rounded-[1.9rem] border border-border bg-card p-2 shadow-lift">
                <div className="relative overflow-hidden rounded-[1.35rem] bg-[linear-gradient(135deg,#101d45_0%,#0d1a3c_45%,#0a3b39_100%)] px-5 py-4 text-white">
                  <div
                    aria-hidden
                    className="absolute -right-10 -top-16 size-40 rounded-full bg-white/10 blur-2xl"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-white/80">
                      MemberPass
                    </span>
                    <Nfc className="size-4 text-white/60" aria-hidden />
                  </div>
                  <p className="mt-5 font-mono text-[0.7rem] tracking-[0.18em] text-white/50">
                    GDG @ PENN STATE
                  </p>
                  <p className="mt-0.5 text-[0.82rem] font-semibold text-white/90">
                    Semester leaderboard
                  </p>
                </div>

                <div className="px-3 pb-2 pt-4">
                  <div className="mb-3 flex items-center justify-between px-1">
                    <p className="type-overline text-muted-foreground">This semester</p>
                    <Trophy className="size-4 text-star" aria-hidden />
                  </div>

                  {podium.length === 0 ? (
                    <EmptyState
                      title="The board is wide open"
                      description="Points appear as members attend events and check out."
                    />
                  ) : (
                    <ul className="space-y-1">
                      {podium.map((entry) => (
                        <li
                          key={entry.slug}
                          className="flex items-center gap-3 rounded-xl px-1.5 py-2 transition-colors hover:bg-muted/60"
                        >
                          <span
                            className={`w-7 shrink-0 font-mono text-sm font-semibold tabular-nums ${
                              entry.rank === 1 ? 'text-star' : 'text-muted-foreground'
                            }`}
                          >
                            {String(entry.rank).padStart(2, '0')}
                          </span>
                          <MemberAvatar
                            name={entry.displayName}
                            photoUrl={entry.photoUrl}
                            size={36}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {entry.displayName}
                            </span>
                            <span className="block truncate text-[0.72rem] text-muted-foreground">
                              {entry.memberNumber ?? 'GDG@PSU member'}
                            </span>
                          </span>
                          <span className="shrink-0 rounded-full bg-primary-soft px-2.5 py-0.5 text-[0.72rem] font-bold tabular-nums text-primary">
                            {entry.points} pts
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <Link
                    href="/leaderboard"
                    className="mt-3 flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-primary transition-colors hover:bg-primary-soft/60"
                  >
                    Full leaderboard
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <SectionHeading
          eyebrow="Upcoming"
          title="Show up. Tap in. Check out."
          description="Attendance is confirmed by an organizer at the door — a tap alone never awards points."
          action={
            <Link href="/events" className={buttonVariants({ variant: 'secondary' })}>
              All events
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          }
        />

        {events.length === 0 ? (
          <EmptyState
            title="Nothing on the calendar yet"
            description="The next workshop or build night will appear here as soon as it is published."
            icon={<CalendarDays />}
            action={
              <Link href="/leaderboard" className={buttonVariants({ variant: 'secondary' })}>
                Browse the leaderboard
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {events.map((event) => (
              <Link
                key={event.id}
                href={`/events/${event.slug}`}
                className="group block rounded-2xl focus-visible:outline-none"
              >
                <Card className="h-full transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-lift">
                  <CardContent className="flex h-full flex-col p-5">
                    <p className="type-overline text-primary">{formatDate(event.startsAt)}</p>
                    <h3 className="mt-2 text-lg font-bold leading-snug transition-colors group-hover:text-primary">
                      {event.name}
                    </h3>
                    <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">
                      {event.summary || 'Details coming soon.'}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays className="size-3.5" aria-hidden />
                        {formatTime(event.startsAt)}
                      </span>
                      {event.location ? (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="size-3.5" aria-hidden />
                          {event.location}
                        </span>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="border-y border-border bg-subtle/70">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
          <div className="grid gap-8 md:grid-cols-[0.8fr_1.2fr] md:gap-12">
            <div>
              <p className="type-overline text-primary">How it works</p>
              <h2 className="type-h2 mt-2 max-w-sm">Built for the people in the room.</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {features.map((item) => {
                const Icon = item.icon;
                return (
                  <Card key={item.title} className="h-full bg-card/80">
                    <CardContent className="p-5">
                      <span className="mb-3 grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <h3 className="text-[0.95rem] font-bold leading-snug">{item.title}</h3>
                      <p className="mt-1.5 text-[0.82rem] leading-relaxed text-muted-foreground">
                        {item.body}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="relative overflow-hidden rounded-[2rem] bg-[linear-gradient(120deg,#132a6b_0%,#16357a_45%,#0b4a45_100%)] px-6 py-10 text-white shadow-glow sm:px-10 sm:py-12">
          <div
            aria-hidden
            className="absolute -right-16 -top-24 size-72 rounded-full bg-brand-blue/30 blur-3xl"
          />
          <div
            aria-hidden
            className="absolute -bottom-24 left-1/3 size-64 rounded-full bg-brand-green/20 blur-3xl"
          />
          <div className="relative flex flex-col gap-7 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <h2 className="type-h2 text-white">
                {dashboard ? "You're already in." : 'Already a member?'}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-white/75">
                {dashboard
                  ? 'Pick up where you left off — your points, stars, event history and digital ID are waiting.'
                  : 'Sign in to see your points, stars, event history and your digital ID — or to pick up something from the rewards shelf.'}
              </p>
            </div>
            <div className="flex flex-col gap-2.5 sm:flex-row md:flex-col">
              {dashboard ? (
                <Link
                  href={dashboard.href}
                  className={buttonVariants({ variant: 'inverse', size: 'lg' })}
                >
                  {dashboard.label}
                </Link>
              ) : (
                <Link href="/login" className={buttonVariants({ variant: 'inverse', size: 'lg' })}>
                  Sign in
                </Link>
              )}
              <Link
                href="/leaderboard"
                className={buttonVariants({
                  variant: 'ghost',
                  size: 'lg',
                  className: 'text-white hover:bg-white/10',
                })}
              >
                Leaderboard
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
