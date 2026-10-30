'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@gdg/ui';
import { RotateCcw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[ui]', error.digest ?? error.message);
  }, [error]);

  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-20 text-center"
    >
      <p className="type-overline text-primary">Error</p>
      <h1 className="type-h2 mt-2">That did not load</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        Nothing changed unless you saw a confirmation.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={reset} className={buttonVariants({})}>
          <RotateCcw className="size-4" aria-hidden />
          Try again
        </button>
        <Link href="/" className={buttonVariants({ variant: 'secondary' })}>
          Go home
        </Link>
      </div>
    </main>
  );
}
