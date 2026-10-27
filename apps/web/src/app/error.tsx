'use client';

import { useEffect } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

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
    <Container maxWidth="sm" sx={{ py: 12, textAlign: 'center' }}>
      <Typography variant="overline" color="primary">
        Error
      </Typography>
      <Typography variant="h2" sx={{ my: 1.5 }}>
        That did not load
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        The action was not completed. Nothing was awarded or changed unless you saw a confirmation.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center' }}>
        <Button variant="contained" onClick={reset}>
          Try again
        </Button>
        <Button href="/">Go home</Button>
      </Box>
    </Container>
  );
}
