import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CalendarDays, MapPin } from 'lucide-react';
import { Badge, Card, CardContent, EmptyState, PageShell, SectionHeading, cn } from '@gdg/ui';
import { listPublicEvents } from '@/lib/public/queries';
import { formatDate, formatTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Events',
  description: 'Workshops, build nights and community events from GDG@PSU.',
};

export default async function EventsPage() {
  const events = await listPublicEvents(60).catch(() => []);

  return (
    <PageShell width="lg">
      <SectionHeading
        headingLevel={1}
        eyebrow="Calendar"
        title="Come build with us"
        description="Main sessions earn points. Bonus sessions need their own check-in."
      />

      {events.length === 0 ? (
        <EmptyState
          title="No published events yet"
          description="Organizers publish events here."
          icon={<CalendarDays />}
        />
      ) : (
        <div className="space-y-3">
          {events.map((event) => {
            const upcoming = new Date(event.endsAt) >= new Date();
            return (
              <Link
                key={event.id}
                href={`/events/${event.slug}`}
                className="group block rounded-2xl focus-visible:outline-none"
              >
                <Card
                  className={cn(
                    'border-l-4 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/50 group-hover:shadow-lift',
                    upcoming ? 'border-l-primary' : 'border-l-border',
                  )}
                >
                  <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:gap-6">
                    <div className="md:w-36 md:shrink-0">
                      <p
                        className={cn(
                          'type-overline',
                          upcoming ? 'text-primary' : 'text-muted-foreground',
                        )}
                      >
                        {upcoming ? 'Upcoming' : 'Past'}
                      </p>
                      <p className="mt-1 text-sm font-bold leading-snug">
                        {formatDate(event.startsAt)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatTime(event.startsAt)} – {formatTime(event.endsAt)}
                      </p>
                    </div>

                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-bold leading-snug transition-colors group-hover:text-primary">
                        {event.name}
                      </h2>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {event.summary || 'Details coming soon.'}
                      </p>
                    </div>

                    {event.location ? (
                      <Badge variant="outline" className="max-w-[16rem] self-start md:self-center">
                        <MapPin className="size-3" aria-hidden />
                        <span className="truncate">{event.location}</span>
                      </Badge>
                    ) : null}

                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary md:shrink-0">
                      Details
                      <ArrowRight
                        className="size-4 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </span>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
