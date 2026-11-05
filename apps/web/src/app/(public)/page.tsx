import Link from 'next/link';
import { ArrowRight, CalendarDays, MapPin, Nfc, ShieldCheck, Star, Trophy } from 'lucide-react';
import {
  buttonVariants,
  Card,
  CardContent,
  EmptyState,
  MemberAvatar,
  SectionHeading,
} from '@gdg/ui';
import { listLeaderboard, listUpcomingPublicEvents } from '@/lib/public/queries';
import { getViewer } from '@/lib/auth/viewer';
import { formatDate, formatTime } from '@/lib/format';
import { SUPPORT_EMAIL } from '@/lib/env';

export const dynamic = 'force-dynamic';

const features = [
  {
    icon: Nfc,
    title: 'Your card is a doorway',
    body: 'A tap opens your profile. Nothing more.',
  },
  {
    icon: Star,
    title: 'Stars are forever',
    body: 'Spend points on merch. Stars only ever grow.',
  },
  {
    icon: ShieldCheck,
    title: 'No silent awards',
    body: 'No check-out, no points.',
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
    listUpcomingPublicEvents(3).catch(() => []),
  ]);
  const podium = leaders.slice(0, 3);

  return (
    <>
      <section className="border-b border-border bg-background">
        <div className="mx-auto grid w-full max-w-[1312px] items-start gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:px-8 lg:py-20">
          <div className="max-w-2xl">
            <p className="type-overline text-muted-foreground">GDG @ Penn State</p>

            <h1 className="type-display mt-4 max-w-[18ch]">Build things. Belong here.</h1>

            <p className="mt-5 max-w-lg text-base leading-6 text-muted-foreground">
              One card. One profile. Every build night counted.
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

            <p className="mt-4 text-xs leading-4 text-muted-foreground">
              By invitation after dues. Questions? {SUPPORT_EMAIL}
            </p>
          </div>

          <div className="border border-border bg-card">
            <div className="bg-[#161616] px-4 py-4 text-white">
              <div className="flex items-center justify-between border-b border-white/20 pb-3">
                <span className="text-xs tracking-[0.32px] text-white/80">MemberPass</span>
                <Nfc className="size-4 text-white/60" aria-hidden />
              </div>
              <p className="mt-4 font-mono text-[0.68rem] tracking-[0.18em] text-white/50">
                GDG @ PENN STATE
              </p>
              <p className="mt-1 text-sm font-semibold text-white/90">Leaderboard</p>
            </div>

            <div className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="type-overline text-muted-foreground">All time</p>
                <Trophy className="size-4 text-star" aria-hidden />
              </div>

              {podium.length === 0 ? (
                <EmptyState
                  title="The board is wide open"
                  description="Points appear as members attend events and check out."
                />
              ) : (
                <ul>
                  {podium.map((entry) => (
                    <li
                      key={entry.slug}
                      className="flex items-center gap-3 border-b border-border px-1 py-2.5 last:border-0"
                    >
                      <span
                        className={`w-7 shrink-0 font-mono text-sm tabular-nums ${
                          entry.rank === 1 ? 'text-star' : 'text-muted-foreground'
                        }`}
                      >
                        {String(entry.rank).padStart(2, '0')}
                      </span>
                      <MemberAvatar name={entry.displayName} photoUrl={entry.photoUrl} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {entry.displayName}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {entry.memberNumber ?? 'GDG@PSU member'}
                        </span>
                      </span>
                      <span className="shrink-0 bg-layer-accent px-2 py-0.5 text-xs tabular-nums text-foreground">
                        {entry.stars} stars
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <Link
                href="/leaderboard"
                className="mt-3 flex h-10 items-center gap-1.5 border-t border-border pt-3 text-sm text-primary hover:underline"
              >
                Full leaderboard
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1312px] px-4 py-14 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Upcoming"
          title="Show up. Tap in. Check out."
          description="A tap opens your profile. An organizer confirms attendance."
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
            description="New events appear here."
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
                className="group block focus-visible:outline-none"
              >
                <Card className="h-full transition-colors group-hover:bg-muted">
                  <CardContent className="flex h-full flex-col p-4">
                    <p className="type-overline text-muted-foreground">
                      {formatDate(event.startsAt)}
                    </p>
                    <h3 className="mt-2 text-base font-semibold leading-6">{event.name}</h3>
                    <p className="mt-1 flex-1 text-sm leading-5 text-muted-foreground">
                      {event.summary || 'Details coming soon.'}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
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

      <section className="border-y border-border bg-card">
        <div className="mx-auto w-full max-w-[1312px] px-4 py-14 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-[0.8fr_1.2fr] md:gap-12">
            <div>
              <p className="type-overline text-muted-foreground">How it works</p>
              <h2 className="type-h2 mt-2 max-w-sm">Built for the people in the room.</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {features.map((item) => {
                const Icon = item.icon;
                return (
                  <Card key={item.title} className="h-full bg-background">
                    <CardContent className="p-4">
                      <span className="mb-3 grid size-10 place-items-center bg-layer-accent text-foreground">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <h3 className="text-sm font-semibold leading-5">{item.title}</h3>
                      <p className="mt-1.5 text-sm leading-5 text-muted-foreground">{item.body}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1312px] px-4 py-14 sm:px-6 lg:px-8">
        <div className="border border-[#393939] bg-[#161616] px-6 py-10 text-white sm:px-10 sm:py-12">
          <div className="flex flex-col gap-7 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <h2 className="type-h2 text-white">
                {dashboard ? "You're already in." : 'Already a member?'}
              </h2>
              <p className="mt-2 text-sm leading-5 text-white/75">
                {dashboard
                  ? 'Your points, stars, history and digital ID.'
                  : 'Points, stars, history and your digital ID.'}
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
