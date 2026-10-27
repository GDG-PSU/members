import type { Metadata } from 'next';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { defaultVisibility, type Visibility } from '@gdg/contracts';
import { requireMember } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { PrivacyForm } from '@/components/member/privacy-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Privacy settings',
  robots: { index: false, follow: false },
};

const columnMap: Record<keyof Visibility, string> = {
  publicProfile: 'public_profile',
  showDisplayName: 'show_display_name',
  showPhoto: 'show_photo',
  showAbout: 'show_about',
  showLinks: 'show_links',
  showMemberNumber: 'show_member_number',
  showMemberSince: 'show_member_since',
  showPoints: 'show_points',
  showStars: 'show_stars',
  showEvents: 'show_events',
  showOnLeaderboard: 'show_on_leaderboard',
  showEmail: 'show_email',
};

export default async function PrivacySettingsPage() {
  const { member } = await requireMember();
  const admin = createSupabaseAdmin();
  const { data } = await admin
    .from('member_profiles')
    .select(Object.values(columnMap).join(', '))
    .eq('member_id', member.id)
    .maybeSingle();

  const initial = { ...defaultVisibility };
  if (data) {
    for (const key of Object.keys(columnMap) as (keyof Visibility)[]) {
      const value = data[columnMap[key] as keyof typeof data];
      if (typeof value === 'boolean') initial[key] = value;
    }
  }

  return (
    <Container maxWidth="lg" sx={{ pb: { xs: 6, md: 9 } }}>
      <Grid container spacing={4}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Stack spacing={1}>
            <Typography variant="overline" color="primary">
              Your call
            </Typography>
            <Typography variant="h2" component="h1" sx={{ fontSize: { xs: '2rem', md: '2.6rem' } }}>
              Privacy settings
            </Typography>
            <Typography color="text.secondary">
              Everything here can be changed at any time. Email is private unless you explicitly choose
              to show it. Turning off the public profile hides every field at once.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
              The leaderboard only includes public profiles with both points and leaderboard visibility
              enabled.
            </Typography>
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <PrivacyForm initial={initial} />
        </Grid>
      </Grid>
    </Container>
  );
}
