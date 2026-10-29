import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { SetupForm } from '@/components/auth/setup-form';
import { getViewer } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { SUPPORT_EMAIL } from '@/lib/env';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Finish your membership',
  robots: { index: false, follow: false },
};

export default async function InviteAcceptPage() {
  const viewer = await getViewer();
  if (!viewer.user) redirect('/login');
  if (viewer.member) redirect('/member');

  const admin = createSupabaseAdmin();
  const { data: invitation } = await admin
    .from('member_invitations')
    .select('id, email, status, paid_since, expires_at')
    .eq('email', (viewer.user.email ?? '').toLowerCase())
    .order('created_at', { ascending: false })
    .maybeSingle();

  const expired = invitation?.expires_at ? new Date(invitation.expires_at) < new Date() : false;
  const usable = invitation?.status === 'pending' && !expired;

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 5, md: 9 } }}>
      {usable ? (
        <Stack spacing={3}>
          <Box>
            <Typography variant="overline" color="primary">
              One-time setup
            </Typography>
            <Typography
              variant="h2"
              component="h1"
              sx={{ mt: 1, mb: 1, fontSize: { xs: '2.1rem', md: '2.6rem' } }}
            >
              Make it yours
            </Typography>
            <Typography color="text.secondary">
              Set a password, add the name and photo organizers will see, and your permanent profile
              is created. Membership since {formatDate(invitation.paid_since)}.
            </Typography>
          </Box>
          <SetupForm email={viewer.user.email ?? ''} />
        </Stack>
      ) : (
        <Card>
          <CardContent sx={{ p: { xs: 3, md: 4 } }}>
            <Typography variant="overline" color="primary">
              Membership
            </Typography>
            <Typography
              variant="h2"
              component="h1"
              sx={{ mt: 1, mb: 2, fontSize: { xs: '2rem', md: '2.5rem' } }}
            >
              {invitation?.status === 'accepted'
                ? 'This invitation was already used'
                : expired
                  ? 'This invitation has expired'
                  : invitation?.status === 'revoked'
                    ? 'This invitation was revoked'
                    : 'No active invitation found'}
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Signed in as {viewer.user.email}. Invitations are single-use and expire after 14 days.
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              Email{' '}
              <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
                {SUPPORT_EMAIL}
              </Box>{' '}
              from this address and an organizer will check your membership record or issue a fresh
              invitation.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button
                href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('GDG@PSU invitation help')}`}
                variant="contained"
              >
                Contact organizers
              </Button>
              <form action="/api/auth/signout" method="post">
                <Button type="submit" color="inherit">
                  Sign out
                </Button>
              </form>
              <Button component="a" href="/">
                Go home
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
