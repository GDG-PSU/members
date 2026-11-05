import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { buttonVariants, Card, CardContent, PageShell, cn } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { EventForm } from '@/components/admin/event-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'New event',
  robots: { index: false, follow: false },
};

export default async function NewEventPage() {
  await requireAdmin();

  return (
    <PageShell width="md">
      <Link
        href="/admin/events"
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-3 mb-2')}
      >
        <ArrowLeft className="size-4" aria-hidden />
        All events
      </Link>

      <div className="mb-6">
        <p className="type-overline text-primary">Calendar</p>
        <h1 className="type-h2 mt-2">New event</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          It is saved as a draft that only organizers can see. Publish it when it is ready.
        </p>
      </div>

      <Card>
        <CardContent className="p-5 sm:p-6">
          <EventForm />
        </CardContent>
      </Card>
    </PageShell>
  );
}
