import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import StarBorderOutlinedIcon from '@mui/icons-material/StarBorderOutlined';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import { MemberAvatar } from '@gdg/ui';
import { getProfileState, getPublicProfile } from '@/lib/public/queries';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ profileSlug: string }>;
}): Promise<Metadata> {
  const { profileSlug } = await params;
  const profile = await getPublicProfile(profileSlug).catch(() => null);
  if (!profile) {
    return { title: 'Member profile', robots: { index: false, follow: false } };
  }
  return {
    title: profile.displayName ?? 'GDG@PSU member',
    description:
      profile.about ??
      `A GDG@PSU member${profile.memberSince ? ` since ${profile.memberSince}` : ''}.`,
    openGraph: {
      title: profile.displayName ?? 'GDG@PSU member',
      images: profile.photoUrl ? [profile.photoUrl] : undefined,
      type: 'profile',
    },
    alternates: { canonical: `/m/${profile.slug}` },
  };
}

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ profileSlug: string }>;
}) {
  const { profileSlug } = await params;
  const profile = await getPublicProfile(profileSlug);
  if (!profile) {
    const state = await getProfileState(profileSlug);
    if (state !== 'private') notFound();
    return <PrivateProfile />;
  }

  const name = profile.displayName ?? 'GDG@PSU member';

  return (
    <Box
      sx={{
        background:
          'radial-gradient(900px 400px at 80% -10%, rgba(20,80,163,0.16), transparent 60%), radial-gradient(600px 320px at 0% 5%, rgba(15,118,110,0.12), transparent 60%)',
        minHeight: '70vh',
      }}
    >
      <Container maxWidth="md" sx={{ py: { xs: 5, md: 9 } }}>
        <Card sx={{ overflow: 'hidden' }}>
          <Box
            sx={{
              height: 8,
              background: 'linear-gradient(90deg, #1450a3 0%, #0f766e 55%, #a16207 100%)',
            }}
          />
          <CardContent sx={{ p: { xs: 3, md: 4.5 } }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={3}
              sx={{ alignItems: { sm: 'center' } }}
            >
              <MemberAvatar name={name} photoUrl={profile.photoUrl} size={104} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h2" sx={{ fontSize: { xs: '2.2rem', md: '3rem' } }}>
                  {name}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
                  {profile.memberNumber ? (
                    <Chip size="small" label={profile.memberNumber} variant="outlined" />
                  ) : null}
                  {profile.memberSince ? (
                    <Chip
                      size="small"
                      label={`Member since ${formatDate(profile.memberSince)}`}
                      variant="outlined"
                    />
                  ) : null}
                </Stack>
                {profile.email ? (
                  <Typography variant="body2" sx={{ mt: 1.5 }}>
                    {profile.email}
                  </Typography>
                ) : null}
              </Box>
            </Stack>

            {profile.about ? (
              <Typography variant="body1" sx={{ mt: 3.5, maxWidth: 620 }}>
                {profile.about}
              </Typography>
            ) : null}

            {profile.links.length > 0 ? (
              <>
                <Divider sx={{ my: 3 }} />
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                  {profile.links.map((link) => (
                    <Chip
                      key={link.url}
                      icon={<LinkOutlinedIcon />}
                      label={link.label}
                      component="a"
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow ugc"
                      clickable
                      variant="outlined"
                    />
                  ))}
                </Stack>
              </>
            ) : null}

            {profile.points !== null ||
            profile.stars !== null ||
            profile.attendedEvents !== null ? (
              <>
                <Divider sx={{ my: 3.5 }} />
                <Grid container spacing={2}>
                  {profile.points !== null ? (
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', color: 'text.secondary' }}
                      >
                        <EmojiEventsOutlinedIcon fontSize="small" />
                        <Typography variant="overline">Spendable points</Typography>
                      </Stack>
                      <Typography variant="h2" sx={{ fontSize: '2.4rem' }}>
                        {profile.points}
                      </Typography>
                    </Grid>
                  ) : null}
                  {profile.stars !== null ? (
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', color: 'text.secondary' }}
                      >
                        <StarBorderOutlinedIcon fontSize="small" />
                        <Typography variant="overline">Lifetime stars</Typography>
                      </Stack>
                      <Typography variant="h2" sx={{ fontSize: '2.4rem' }}>
                        {profile.stars}
                      </Typography>
                    </Grid>
                  ) : null}
                  {profile.attendedEvents !== null ? (
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', color: 'text.secondary' }}
                      >
                        <EmojiEventsOutlinedIcon fontSize="small" />
                        <Typography variant="overline">Events attended</Typography>
                      </Stack>
                      <Typography variant="h2" sx={{ fontSize: '2.4rem' }}>
                        {profile.attendedEvents}
                      </Typography>
                    </Grid>
                  ) : null}
                </Grid>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ mt: 3, justifyContent: 'space-between' }}
        >
          <Typography variant="caption" color="text.secondary">
            This profile is managed by the member. Visibility is theirs to change.
          </Typography>
          <Button component="a" href="/leaderboard" size="small">
            See the leaderboard
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}

/** Neutral state for an existing profile the member has made private. */
function PrivateProfile() {
  return (
    <Box sx={{ minHeight: '60vh' }}>
      <Container maxWidth="sm" sx={{ py: { xs: 6, md: 10 } }}>
        <Card>
          <CardContent sx={{ p: { xs: 3, md: 4.5 }, textAlign: 'center' }}>
            <Typography variant="overline" color="text.secondary">
              Member profile
            </Typography>
            <Typography variant="h3" sx={{ mt: 1, mb: 1.5 }}>
              This profile is private
            </Typography>
            <Typography color="text.secondary">
              This member has chosen to keep their profile hidden. If you scanned their card, ask
              them directly — a private profile never exposes contact details here.
            </Typography>
            <Button component="a" href="/" variant="outlined" sx={{ mt: 3 }}>
              Back to the hub
            </Button>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
