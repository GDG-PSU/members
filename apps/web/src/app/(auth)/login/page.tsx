import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { LoginForm } from '@/components/auth/login-form';
import { getViewer } from '@/lib/auth/viewer';
import { SUPPORT_EMAIL } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; next?: string }>;
}) {
  const viewer = await getViewer();
  if (viewer.user) {
    redirect(viewer.member ? '/member' : viewer.isAdmin ? '/admin' : '/invite/accept');
  }
  const { notice } = await searchParams;

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 6, md: 10 } }}>
      <Card>
        <CardContent sx={{ p: { xs: 3, md: 4 } }}>
          <Typography variant="overline" color="primary">
            Member access
          </Typography>
          <Typography variant="h2" component="h1" sx={{ mt: 1, mb: 1, fontSize: { xs: '2rem', md: '2.6rem' } }}>
            Welcome back
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Use the email your invitation was sent to.
          </Typography>
          {notice === 'signed-out' ? (
            <Typography variant="body2" sx={{ mb: 2, color: 'success.main' }} role="status">
              You have been signed out.
            </Typography>
          ) : null}
          {notice === 'invalid-link' ? (
            <Typography variant="body2" sx={{ mb: 2, color: 'error.main' }} role="alert">
              That sign-in link is invalid or has already been used. Ask GDG@PSU for a fresh link, or sign
              in with your password.
            </Typography>
          ) : null}
          <LoginForm />
          <Divider sx={{ my: 3 }} />
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              Forgot your password? Email{' '}
              <Box component="a" href={`mailto:${SUPPORT_EMAIL}?subject=GDG%40PSU%20password%20reset`} sx={{ color: 'primary.main' }}>
                {SUPPORT_EMAIL}
              </Box>{' '}
              from your registered address. An admin will send a recovery link.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Not a member yet? Membership opens after dues are recorded — no public signup.
            </Typography>
            <Button component="a" href="/forgot-password" size="small" sx={{ alignSelf: 'flex-start', px: 0 }}>
              Password help
            </Button>
          </Stack>
        </CardContent>
      </Card>
      <Stack direction="row" spacing={1} sx={{ mt: 3, justifyContent: 'center' }}>
        <Button component="a" href="/" size="small" color="inherit">
          ← Back to GDG@PSU
        </Button>
      </Stack>
    </Container>
  );
}
