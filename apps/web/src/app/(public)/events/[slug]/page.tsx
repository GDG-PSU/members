import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Clock, MapPin, Star } from 'lucide-react';
import { Badge, buttonVariants, Card, CardContent, PageShell, cn } from '@gdg/ui';
import { getPublicEvent } from '@/lib/public/queries';
import { formatDate, formatTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublicEvent(slug).catch(() => null);
  return {
    title: data?.event.name ?? 'Event',
    description: data?.event.summary ?? undefined,
  };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getPublicEvent(slug);
  if (!data) notFound();
  const { event, sessions } = data;
  const main = sessions.find((session) => session.kind === 'main');
  const bonus = sessions.filter((session) => session.kind === 'bonus');

  return (
    <PageShell width="lg">
      <Link
        href="/events"
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-3 mb-4')}
      >
        <ArrowLeft className="size-4" aria-hidden />
        All events
      </Link>

      <div className="grid gap-8 md:grid-cols-[1.5fr_1fr] md:items-start md:gap-10">
        <div>
          <Badge variant="primary">{formatDate(event.startsAt)}</Badge>
          <h1 className="type-h1 mt-4 text-balance">{event.name}</h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {event.summary || 'Details coming soon.'}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Badge variant="outline">
              <MapPin className="size-3.5" aria-hidden />
              {event.location || 'Location to be announced'}
            </Badge>
            <Badge variant="outline">
              <Clock className="size-3.5" aria-hidden />
              {formatTime(event.startsAt)} – {formatTime(event.endsAt)}
            </Badge>
          </div>

          <section className="mt-10">
            <h2 className="type-h3 mb-4">Sessions</h2>
            <div className="space-y-3">
              {main ? (
                <Card>
                  <CardContent className="flex items-start justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <p className="type-overline text-primary">Main session</p>
                      <h3 className="mt-1 text-base font-bold">{main.name}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {formatTime(main.startsAt)} – {formatTime(main.endsAt)} · Check out to
                        qualify
                      </p>
                    </div>
                    <Badge variant="star" className="shrink-0">
                      <Star className="size-3.5" aria-hidden />+{main.rewardPoints} pts
                    </Badge>
                  </CardContent>
                </Card>
              ) : null}

              {bonus.map((session) => (
                <Card key={session.id}>
                  <CardContent className="flex items-start justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <p className="type-overline text-secondary">Bonus session</p>
                      <h3 className="mt-1 text-base font-bold">{session.name}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {formatTime(session.startsAt)} – {formatTime(session.endsAt)} · Requires its
                        own check-in and check-out
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      +{session.rewardPoints} pts
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        </div>

        <aside>
          <Card className="md:sticky md:top-24">
            <CardContent className="p-5 sm:p-6">
              <h2 className="text-base font-bold">How attendance works</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Tap at the kiosk, then confirm with an organizer:
              </p>

              <ol className="my-5 space-y-3">
                {[
                  'Organizer confirms check-in.',
                  'Stay for the session.',
                  'Organizer confirms check-out.',
                  'Points land after a qualifying stay.',
                ].map((step, index) => (
                  <li key={step} className="flex items-start gap-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[0.7rem] font-extrabold text-primary-foreground">
                      {index + 1}
                    </span>
                    <span className="text-sm leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>

              <div className="h-px bg-border" />

              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                No check-out, no points. Email GDG@PSU if something went wrong.
              </p>

              <Link href="/login" className={cn(buttonVariants({}), 'mt-4 w-full')}>
                Member sign in
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>
    </PageShell>
  );
}
