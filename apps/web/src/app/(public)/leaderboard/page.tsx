import Link from 'next/link';
import type { Metadata } from 'next';
import { Trophy } from 'lucide-react';
import {
  buttonVariants,
  Card,
  DataTable,
  EmptyState,
  MemberAvatar,
  PageShell,
  SectionHeading,
  type DataTableColumn,
} from '@gdg/ui';
import { listLeaderboard } from '@/lib/public/queries';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Leaderboard',
  description: 'The GDG@PSU member leaderboard, built from verified event attendance.',
};

type Entry = Awaited<ReturnType<typeof listLeaderboard>>[number];

export default async function LeaderboardPage() {
  const entries = await listLeaderboard(100, 0).catch(() => []);
  const top = entries.slice(0, 3);
  const rest = entries.slice(3);

  const columns: DataTableColumn<Entry>[] = [
    {
      key: 'rank',
      header: 'Rank',
      width: 72,
      render: (entry) => (
        <span className="font-mono text-sm font-semibold tabular-nums text-muted-foreground">
          {entry.rank}
        </span>
      ),
    },
    {
      key: 'member',
      header: 'Member',
      render: (entry) => (
        <span className="inline-flex items-center gap-2.5">
          <MemberAvatar name={entry.displayName} photoUrl={entry.photoUrl} size={30} />
          <Link
            href={`/m/${entry.slug}`}
            className="font-semibold underline-offset-2 hover:text-primary hover:underline"
          >
            {entry.displayName}
          </Link>
        </span>
      ),
    },
    {
      key: 'number',
      header: 'Member no.',
      render: (entry) => <span className="text-muted-foreground">{entry.memberNumber ?? '—'}</span>,
    },
    {
      key: 'points',
      header: 'Points',
      align: 'right',
      render: (entry) => <span className="font-bold tabular-nums">{entry.points}</span>,
    },
  ];

  return (
    <PageShell width="lg" className="py-10 sm:py-14">
      <SectionHeading
        headingLevel={1}
        eyebrow="Semester standings"
        title="The leaderboard"
        description="Ranked by spendable points earned from confirmed attendance and organizer-recognized contributions. Stars are not part of the ranking."
      />

      {entries.length === 0 ? (
        <EmptyState
          title="No public rankings yet"
          description="Members choose whether to appear here. Once attendance is confirmed and a member opts in, the board fills up."
          icon={<Trophy />}
          action={
            <Link href="/events" className={buttonVariants({ variant: 'secondary' })}>
              See upcoming events
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-8 grid items-end gap-4 md:grid-cols-3">
            {top.map((entry, index) => {
              const rank = index + 1;
              const order = rank === 1 ? 'md:order-2' : rank === 2 ? 'md:order-1' : 'md:order-3';
              const height =
                rank === 1
                  ? 'md:min-h-[13rem]'
                  : rank === 2
                    ? 'md:min-h-[11rem]'
                    : 'md:min-h-[10rem]';
              return (
                <Card
                  key={entry.slug}
                  className={[
                    'relative flex flex-col justify-end overflow-hidden p-5 transition-shadow',
                    order,
                    height,
                    rank === 1 ? 'border-star/50 shadow-lift ring-1 ring-star/20' : '',
                  ].join(' ')}
                >
                  {rank === 1 ? (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(60%_100%_at_50%_0%,rgb(251_188_4/0.18),transparent_70%)]"
                    />
                  ) : null}
                  <div className="relative flex items-center justify-between">
                    <span
                      className={[
                        'type-overline',
                        rank === 1
                          ? 'text-star'
                          : rank === 2
                            ? 'text-muted-foreground'
                            : 'text-secondary',
                      ].join(' ')}
                    >
                      #{entry.rank}
                    </span>
                    {rank === 1 ? <Trophy className="size-4 text-star" aria-hidden /> : null}
                  </div>
                  <div className="relative mt-4 flex items-center gap-3">
                    <MemberAvatar name={entry.displayName} photoUrl={entry.photoUrl} size={52} />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/m/${entry.slug}`}
                        className="block truncate text-base font-bold underline-offset-2 hover:text-primary hover:underline"
                      >
                        {entry.displayName}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {entry.memberNumber ?? 'GDG@PSU member'}
                      </p>
                    </div>
                  </div>
                  <div className="relative mt-4 flex items-baseline gap-1.5">
                    <span className="text-2xl font-extrabold tabular-nums tracking-[-0.03em]">
                      {entry.points}
                    </span>
                    <span className="text-xs font-semibold text-muted-foreground">pts</span>
                  </div>
                </Card>
              );
            })}
          </div>

          <DataTable
            columns={columns}
            rows={rest.length > 0 ? rest : top}
            getRowKey={(entry) => entry.slug}
            caption="Full ranking"
          />

          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Only members who opted into the leaderboard and public points appear. Missing names are
            not zero-point members.
          </p>
        </>
      )}
    </PageShell>
  );
}
