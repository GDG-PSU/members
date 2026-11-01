import Link from 'next/link';
import { Wordmark } from '@gdg/ui';
import { SUPPORT_EMAIL } from '@/lib/env';

export function AppFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-background">
      <div className="mx-auto w-full max-w-[1312px] px-4 py-8 lg:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Wordmark compact />
            <p className="mt-1 text-xs leading-4 text-muted-foreground">GDG @ Penn State</p>
          </div>
          <nav
            aria-label="Footer"
            className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs leading-4"
          >
            <Link
              href="/events"
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Events
            </Link>
            <Link
              href="/leaderboard"
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Leaderboard
            </Link>
            <Link
              href="/privacy"
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Privacy
            </Link>
            <span className="text-muted-foreground">Support: {SUPPORT_EMAIL}</span>
          </nav>
        </div>
        <div className="mt-6 border-t border-border pt-4">
          <p className="text-xs leading-4 text-muted-foreground">
            Card links are not credentials. Staff confirm attendance.
          </p>
        </div>
      </div>
    </footer>
  );
}
