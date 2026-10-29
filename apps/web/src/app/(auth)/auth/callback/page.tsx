import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@gdg/ui';
import { CallbackHandler } from '@/components/auth/callback-handler';

export const metadata: Metadata = {
  title: 'Completing sign in',
  robots: { index: false, follow: false },
};

export default function AuthCallbackPage() {
  return (
    <div className="py-6 text-center">
      <Suspense fallback={<LoadingState label="Completing sign in" />}>
        <CallbackHandler />
      </Suspense>
      <noscript>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          JavaScript is required to finish sign in. Contact GDG@PSU for help.
        </p>
      </noscript>
    </div>
  );
}
