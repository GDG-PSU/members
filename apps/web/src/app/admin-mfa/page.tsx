import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { getViewer } from '@/lib/auth/viewer';
import { MfaPanel } from '@/components/admin/mfa-panel';
import { SUPPORT_EMAIL } from '@/lib/env';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Organizer security',
  robots: { index: false, follow: false },
};

export default async function AdminMfaPage() {
  const viewer = await getViewer();
  if (!viewer.user) redirect('/login');
  if (!viewer.isAdmin) redirect('/');

  const { data: assurance } = await viewer.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel === 'aal2') redirect('/admin');

  const { data: factors } = await viewer.supabase.auth.mfa.listFactors();
  const verified = (factors?.totp ?? []).filter((factor) => factor.status === 'verified');

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 6, md: 10 } }}>
      <Card>
        <CardContent sx={{ p: { xs: 3, md: 4 } }}>
          <Typography variant="overline" color="primary">
            Organizer security
          </Typography>
          <Typography variant="h2" sx={{ mt: 1, mb: 1.5, fontSize: { xs: '2rem', md: '2.5rem' } }}>
            Two-factor required
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Admin routes require a verified authenticator (TOTP) session. This protects member data, the
            points ledger and every event control.
          </Typography>
          <MfaPanel
            hasVerifiedFactor={verified.length > 0}
            email={viewer.user.email ?? ''}
            verifiedFactorId={verified[0]?.id}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
            Lost your authenticator? Contact {SUPPORT_EMAIL} — an organizer with account access must reset
            the factor from Supabase.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <form action="/api/auth/signout" method="post">
              <Typography component="button" type="submit" variant="caption" sx={{ background: 'none', border: 0, cursor: 'pointer', color: 'text.secondary' }}>
                Sign out
              </Typography>
            </form>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}
