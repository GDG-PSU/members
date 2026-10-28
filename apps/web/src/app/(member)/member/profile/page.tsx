import type { Metadata } from 'next';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { requireMember } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { profilePhotoUrl } from '@/lib/profile/photo';
import { ProfileForm } from '@/components/member/profile-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Edit profile',
  robots: { index: false, follow: false },
};

export default async function ProfilePage() {
  const { member } = await requireMember();
  const admin = createSupabaseAdmin();
  const { data: profile } = await admin
    .from('member_profiles')
    .select('display_name, about, links, photo_path, profile_slug')
    .eq('member_id', member.id)
    .maybeSingle();

  const links = Array.isArray(profile?.links)
    ? (profile.links as { label?: string; url?: string }[])
        .filter((link) => typeof link?.label === 'string' && typeof link?.url === 'string')
        .map((link) => ({ label: link.label as string, url: link.url as string }))
    : [];

  return (
    <Container maxWidth="lg" sx={{ pb: { xs: 6, md: 9 } }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography variant="overline" color="primary">
          Public identity
        </Typography>
        <Typography variant="h2" component="h1" sx={{ fontSize: { xs: '2rem', md: '2.6rem' } }}>
          Your profile
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 560 }}>
          This is what people see at /m/{profile?.profile_slug ?? member.slug}. Name and photo are
          required, but you can hide either from the public view in Privacy.
        </Typography>
      </Stack>
      <ProfileForm
        initialName={profile?.display_name ?? member.displayName}
        initialAbout={(profile?.about as string | null) ?? ''}
        initialLinks={links}
        photoUrl={profilePhotoUrl(member.slug)}
      />
    </Container>
  );
}
