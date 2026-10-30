import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleSlash } from 'lucide-react';
import { buttonVariants, PageShell } from '@gdg/ui';

export const metadata: Metadata = {
  title: 'Card unavailable',
  robots: { index: false, follow: false },
};

export default function CardUnavailablePage() {
  return (
    <PageShell width="sm" className="py-16 sm:py-24">
      <div className="flex flex-col items-center text-center">
        <span className="mb-5 grid size-14 place-items-center rounded-2xl border border-border bg-card text-muted-foreground shadow-card">
          <CircleSlash className="size-6" aria-hidden />
        </span>
        <p className="type-overline text-primary">Card link</p>
        <h1 className="type-h2 mt-2">This card link is not active</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          It may be replaced or reported lost. Ask an organizer for a fresh card.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className={buttonVariants({})}>
            Go home
          </Link>
          <Link href="/login" className={buttonVariants({ variant: 'secondary' })}>
            Sign in for a digital ID
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
