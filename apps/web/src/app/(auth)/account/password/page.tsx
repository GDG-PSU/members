import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { PasswordForm } from '@/components/auth/password-form';
import { getViewer } from '@/lib/auth/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Set a new password',
  robots: { index: false, follow: false },
};

export default async function AccountPasswordPage() {
  const viewer = await getViewer();
  if (!viewer.user) redirect('/login?next=/account/password');

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 5, md: 9 } }}>
      <Stack spacing={3}>
        <Typography variant="overline" color="primary">
          Account recovery
        </Typography>
        <Typography variant="h2" component="h1" sx={{ fontSize: { xs: '2rem', md: '2.6rem' } }}>
          Set a new password
        </Typography>
        <Card>
          <CardContent sx={{ p: { xs: 3, md: 4 } }}>
            <PasswordForm email={viewer.user.email ?? ''} />
          </CardContent>
        </Card>
      </Stack>
    </Container>
  );
}
