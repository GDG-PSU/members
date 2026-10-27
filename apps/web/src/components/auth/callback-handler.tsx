'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LoadingState } from '@gdg/ui';

export function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const next = searchParams.get('next') ?? '/invite/accept';
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    const authError = hash.get('error_description') ?? searchParams.get('error_description');

    if (authError || !accessToken || !refreshToken) {
      router.replace('/login?notice=invalid-link');
      return;
    }

    fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken, refreshToken, next }),
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { redirectTo?: string; error?: string };
        if (!response.ok) throw new Error(body.error ?? 'Could not complete sign in.');
        window.history.replaceState(null, '', window.location.pathname);
        router.replace(body.redirectTo ?? next);
      })
      .catch(() => {
        router.replace('/login?notice=invalid-link');
      });
  }, [router, searchParams]);

  return <LoadingState label="Completing sign in" />;
}
