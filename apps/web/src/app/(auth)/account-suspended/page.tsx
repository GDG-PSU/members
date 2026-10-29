import type { Metadata } from 'next';
import { LockKeyhole } from 'lucide-react';
import { Button, buttonVariants, Card, CardContent } from '@gdg/ui';
import { SUPPORT_EMAIL } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Membership inactive',
  robots: { index: false, follow: false },
};

export default function SuspendedPage() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6 text-center sm:p-8">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-warning/10 text-warning ring-1 ring-warning/20">
          <LockKeyhole className="size-5" aria-hidden />
        </span>
        <p className="type-overline mt-4 text-primary">Membership</p>
        <h1 className="type-h2 mt-2">This membership is inactive</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Your account still exists, but access to the member area is paused. Contact{' '}
          {SUPPORT_EMAIL} from your registered address and an organizer can review the status.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
          <a href={`mailto:${SUPPORT_EMAIL}`} className={buttonVariants({})}>
            Contact organizers
          </a>
          <form action="/api/auth/signout" method="post">
            <Button type="submit" variant="secondary" className="w-full sm:w-auto">
              Sign out
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
