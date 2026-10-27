import type { Metadata } from 'next';
import { Suspense } from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import { LoadingState } from '@gdg/ui';
import { CallbackHandler } from '@/components/auth/callback-handler';

export const metadata: Metadata = {
  title: 'Completing sign in',
  robots: { index: false, follow: false },
};

export default function AuthCallbackPage() {
  return (
    <Container maxWidth="sm" sx={{ py: 10 }}>
      <Suspense fallback={<LoadingState label="Completing sign in" />}>
        <CallbackHandler />
      </Suspense>
      <Box sx={{ mt: 2 }}>
        <noscript>
          <p>JavaScript is required to finish sign in. Contact GDG@PSU for help.</p>
        </noscript>
      </Box>
    </Container>
  );
}
