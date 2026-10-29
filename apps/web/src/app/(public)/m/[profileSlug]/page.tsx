import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, CalendarDays, Link2, Lock, Star, Trophy } from 'lucide-react';
import { buttonVariants, Card, CardContent, MemberAvatar, PageShell } from '@gdg/ui';
import { getProfileState, getPublicProfile } from '@/lib/public/queries';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ profileSlug: string }>;
}): Promise<Metadata> {
  const { profileSlug } = await params;
  const profile = await getPublicProfile(profileSlug).catch(() => null);
  if (!profile) {
    return { title: 'Member profile', robots: { index: false, follow: false } };
  }
  return {
    title: profile.displayName ?? 'GDG@PSU member',
    description:
      profile.about ??
      `A GDG@PSU member${profile.memberSince ? ` since ${profile.memberSince}` : ''}.`,
    openGraph: {
      title: profile.displayName ?? 'GDG@PSU member',
      images: profile.photoUrl ? [profile.photoUrl] : undefined,
      type: 'profile',
    },
    alternates: { canonical: `/m/${profile.slug}` },
  };
}

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ profileSlug: string }>;
}) {
  const { profileSlug } = await params;
  const profile = await getPublicProfile(profileSlug);
  if (!profile) {
    const state = await getProfileState(profileSlug);
    if (state !== 'private') notFound();
    return <PrivateProfile />;
  }

  const name = profile.displayName ?? 'GDG@PSU member';
  const hasStats =
    profile.points !== null || profile.stars !== null || profile.attendedEvents !== null;

  return (
    <PageShell width="md" className="py-10 sm:py-14">
      <Card className="overflow-hidden">
        <div
          aria-hidden
          className="h-1.5 w-full bg-[linear-gradient(90deg,#4285f4_0%,#ea4335_25%,#fbbc04_50%,#34a853_75%,#4285f4_100%)]"
        />
        <CardContent className="p-6 sm:p-9">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <MemberAvatar name={name} photoUrl={profile.photoUrl} size={104} />
            <div className="min-w-0 flex-1">
              <h1 className="type-h1">{name}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {profile.memberNumber ? (
                  <span className="inline-flex items-center rounded-full border border-border bg-subtle px-2.5 py-0.5 font-mono text-[0.72rem] font-semibold text-muted-foreground">
                    {profile.memberNumber}
                  </span>
                ) : null}
                {profile.memberSince ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-subtle px-2.5 py-0.5 text-[0.72rem] font-medium text-muted-foreground">
                    <CalendarDays className="size-3" aria-hidden />
                    Member since {formatDate(profile.memberSince)}
                  </span>
                ) : null}
              </div>
              {profile.email ? (
                <a
                  href={`mailto:${profile.email}`}
                  className="mt-2.5 inline-flex text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  {profile.email}
                </a>
              ) : null}
            </div>
          </div>

          {profile.about ? (
            <p className="mt-6 max-w-2xl text-[0.95rem] leading-relaxed text-muted-foreground">
              {profile.about}
            </p>
          ) : null}

          {profile.links.length > 0 ? (
            <>
              <div className="my-6 h-px bg-border" />
              <div className="flex flex-wrap gap-2">
                {profile.links.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    <Link2 className="size-3.5" aria-hidden />
                    {link.label}
                  </a>
                ))}
              </div>
            </>
          ) : null}

          {hasStats ? (
            <>
              <div className="my-6 h-px bg-border" />
              <div className="grid gap-3 sm:grid-cols-3">
                {profile.points !== null ? (
                  <div className="rounded-xl border border-border bg-subtle px-4 py-3">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Trophy className="size-3.5" aria-hidden />
                      <span className="type-overline text-muted-foreground">Spendable points</span>
                    </div>
                    <p className="mt-1 text-[1.9rem] font-extrabold leading-none tabular-nums tracking-[-0.03em]">
                      {profile.points}
                    </p>
                  </div>
                ) : null}
                {profile.stars !== null ? (
                  <div className="rounded-xl border border-border bg-subtle px-4 py-3">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Star className="size-3.5" aria-hidden />
                      <span className="type-overline text-muted-foreground">Lifetime stars</span>
                    </div>
                    <p className="mt-1 text-[1.9rem] font-extrabold leading-none tabular-nums tracking-[-0.03em]">
                      {profile.stars}
                    </p>
                  </div>
                ) : null}
                {profile.attendedEvents !== null ? (
                  <div className="rounded-xl border border-border bg-subtle px-4 py-3">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <CalendarDays className="size-3.5" aria-hidden />
                      <span className="type-overline text-muted-foreground">Events attended</span>
                    </div>
                    <p className="mt-1 text-[1.9rem] font-extrabold leading-none tabular-nums tracking-[-0.03em]">
                      {profile.attendedEvents}
                    </p>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-muted-foreground">
          This profile is managed by the member. Visibility is theirs to change.
        </p>
        <Link href="/leaderboard" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          See the leaderboard
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </PageShell>
  );
}

/** Neutral state for an existing profile the member has made private. */
function PrivateProfile() {
  return (
    <PageShell width="sm" className="py-14 sm:py-20">
      <Card>
        <CardContent className="flex flex-col items-center p-8 text-center sm:p-10">
          <span className="mb-4 grid size-12 place-items-center rounded-2xl border border-border bg-subtle text-muted-foreground">
            <Lock className="size-5" aria-hidden />
          </span>
          <p className="type-overline text-muted-foreground">Member profile</p>
          <h1 className="type-h3 mt-2">This profile is private</h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            This member has chosen to keep their profile hidden. If you scanned their card, ask them
            directly — a private profile never exposes contact details here.
          </p>
          <Link href="/" className={buttonVariants({ variant: 'secondary', className: 'mt-6' })}>
            Back to the hub
          </Link>
        </CardContent>
      </Card>
    </PageShell>
  );
}
