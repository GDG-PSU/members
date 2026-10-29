import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

export const metadata: Metadata = {
  title: 'Card unavailable',
  robots: { index: false, follow: false },
};

export default function CardUnavailablePage() {
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 8, md: 12 }, textAlign: 'center' }}>
      <Typography variant="overline" color="primary">
        Card link
      </Typography>
      <Typography variant="h2" component="h1" sx={{ mt: 1, mb: 2 }}>
        This card link is not active
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 4 }}>
        It may have been replaced or reported lost. Ask an organizer at the next event and they can
        issue a fresh card without changing your profile.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button component="a" href="/" variant="contained">
          Go home
        </Button>
        <Button component="a" href="/login">
          Sign in for a digital ID
        </Button>
      </Box>
    </Container>
  );
}
