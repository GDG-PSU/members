import { redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import { requireAdmin } from '@/lib/auth/viewer';
import { AdminNav } from '@/components/admin/admin-nav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireAdmin();
  const { data: assurance } = await viewer.supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (assurance?.currentLevel !== 'aal2') {
    redirect('/admin-mfa');
  }

  return (
    <Box component="main" id="main">
      <Container maxWidth="xl" sx={{ pt: { xs: 2, md: 3 } }}>
        <AdminNav />
      </Container>
      {children}
    </Box>
  );
}
