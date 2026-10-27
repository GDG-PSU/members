import type { Metadata } from 'next';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import { SUPPORT_EMAIL } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Membership inactive',
  robots: { index: false, follow: false },
};

export default function SuspendedPage() {
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 8, md: 12 }, textAlign: 'center' }}>
      <Typography variant="overline" color="primary">
        Membership
      </Typography>
      <Typography variant="h2" component="h1" sx={{ my: 1.5 }}>
        This membership is inactive
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 4 }}>
        Your account still exists, but access to the member area is paused. Contact {SUPPORT_EMAIL} from
        your registered address and an organizer can review the status.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button href={`mailto:${SUPPORT_EMAIL}`} variant="contained">
          Contact organizers
        </Button>
        <form action="/api/auth/signout" method="post">
          <Button type="submit" color="inherit">
            Sign out
          </Button>
        </form>
      </Box>
    </Container>
  );
}
