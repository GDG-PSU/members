import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { SUPPORT_EMAIL } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Password help',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('GDG@PSU password reset')}&body=${encodeURIComponent(
    'Hi organizers,\n\nPlease send me a password reset link for my GDG@PSU member account.\n\nRegistered email:\n',
  )}`;

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 6, md: 10 } }}>
      <Card>
        <CardContent sx={{ p: { xs: 3, md: 4 } }}>
          <Typography variant="overline" color="primary">
            Account recovery
          </Typography>
          <Typography
            variant="h2"
            component="h1"
            sx={{ mt: 1, mb: 2, fontSize: { xs: '2rem', md: '2.5rem' } }}
          >
            Password help, handled by a person
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Member password resets are not self-service. Email GDG@PSU from your registered address
            and an organizer will trigger a single-use Supabase recovery link for your account.
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            We will never ask for your password or send one by email.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button href={mailto} variant="contained">
              Email {SUPPORT_EMAIL}
            </Button>
            <Button component="a" href="/login">
              Back to sign in
            </Button>
          </Stack>
          <Box sx={{ mt: 4, p: 2, bgcolor: 'surfaceMuted.main', borderRadius: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Organizers: recovery is initiated from Admin → Members → a member → &quot;Send
              recovery link&quot;. The action is audited and never exposes the token in the admin
              UI.
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}
