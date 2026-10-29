import Link from 'next/link';
import { Wordmark } from '@gdg/ui';
import { SUPPORT_EMAIL } from '@/lib/env';

export function AppFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-subtle/60">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Wordmark compact />
            <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted-foreground">
              The member pass for Google Developer Group at Penn State.
            </p>
          </div>
          <nav
            aria-label="Footer"
            className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium"
          >
            <Link
              href="/events"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Events
            </Link>
            <Link
              href="/leaderboard"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Leaderboard
            </Link>
            <Link
              href="/privacy"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Privacy
            </Link>
            <span className="text-muted-foreground">Support: {SUPPORT_EMAIL}</span>
          </nav>
        </div>
        <div className="mt-6 border-t border-border pt-5">
          <p className="text-[0.72rem] leading-relaxed text-muted-foreground">
            Card links are identifiers, not credentials. Attendance always requires a human check-in
            and check-out.
          </p>
        </div>
      </div>
    </footer>
  );
}
