import Link from 'next/link';
import { buttonVariants } from '@gdg/ui';

export default function NotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-20 text-center"
    >
      <p className="type-overline text-primary">404</p>
      <h1 className="type-h2 mt-2">This page is not here</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        The link may have expired, the member may have made their profile private, or a card may
        have been replaced.
      </p>
      <Link href="/" className={buttonVariants({ className: 'mt-6' })}>
        Back to MemberPass
      </Link>
    </main>
  );
}
