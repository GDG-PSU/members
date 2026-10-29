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
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import NfcIcon from '@mui/icons-material/Nfc';
import StarBorderOutlinedIcon from '@mui/icons-material/StarBorderOutlined';
import { EmptyState, MemberAvatar, SectionHeading } from '@gdg/ui';
import { listLeaderboard, listPublicEvents } from '@/lib/public/queries';
import { formatDate, formatTime } from '@/lib/format';
import { SUPPORT_EMAIL } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [leaders, events] = await Promise.all([
    listLeaderboard(5, 0).catch(() => []),
    listPublicEvents(3).catch(() => []),
  ]);
  const podium = leaders.slice(0, 3);

  return (
    <>
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderBottom: '1px solid',
          borderColor: 'divider',
          background:
            'radial-gradient(1100px 480px at 82% -10%, rgba(20,80,163,0.18), transparent 65%), radial-gradient(700px 400px at 4% 8%, rgba(15,118,110,0.12), transparent 60%)',
        }}
      >
        <Container maxWidth="lg" sx={{ py: { xs: 7, md: 11 } }}>
          <Grid container spacing={{ xs: 6, md: 8 }} sx={{ alignItems: 'center' }}>
            <Grid size={{ xs: 12, md: 7 }}>
              <Chip
                label="Penn State's student developer community"
                size="small"
                sx={{ mb: 3, bgcolor: 'background.paper' }}
              />
              <Typography variant="h1" sx={{ maxWidth: 760 }}>
                Build things.
                <br />
                <Box component="span" sx={{ color: 'primary.main' }}>
                  Belong here.
                </Box>
              </Typography>
              <Typography
                variant="subtitle1"
                component="p"
                sx={{ mt: 3, maxWidth: 520, color: 'text.secondary', fontSize: '1.1rem' }}
              >
                One card. One profile. Every event, workshop and late-night build counted — for the
                people who show up and make GDG@PSU what it is.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 4 }}>
                <Button
                  component="a"
                  href="/events"
                  variant="contained"
                  size="large"
                  endIcon={<ArrowForwardIcon />}
                >
                  See what&apos;s next
                </Button>
                <Button component="a" href="/login" size="large" variant="outlined">
                  Member sign in
                </Button>
              </Stack>
              <Typography
                variant="caption"
                sx={{ display: 'block', mt: 2, color: 'text.secondary' }}
              >
                Membership is by invitation after dues are recorded. Questions? {SUPPORT_EMAIL}
              </Typography>
            </Grid>

            <Grid size={{ xs: 12, md: 5 }}>
              <Card
                sx={{
                  p: 0.5,
                  bgcolor: 'background.paper',
                  boxShadow: '0 24px 80px rgba(11,18,32,0.14)',
                }}
              >
                <CardContent sx={{ p: 3 }}>
                  <Stack
                    direction="row"
                    sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}
                  >
                    <Typography variant="overline" color="text.secondary">
                      This semester&apos;s leaders
                    </Typography>
                    <EmojiEventsOutlinedIcon fontSize="small" color="primary" />
                  </Stack>
                  {podium.length === 0 ? (
                    <EmptyState
                      title="The board is wide open"
                      description="Points appear as members attend events and check out."
                    />
                  ) : (
                    <Stack spacing={1.75} divider={<Divider flexItem />}>
                      {podium.map((entry) => (
                        <Stack
                          key={entry.slug}
                          direction="row"
                          spacing={1.5}
                          sx={{ alignItems: 'center' }}
                        >
                          <Typography
                            sx={{
                              width: 28,
                              fontWeight: 800,
                              color: entry.rank === 1 ? 'star.main' : 'text.secondary',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {String(entry.rank).padStart(2, '0')}
                          </Typography>
                          <MemberAvatar
                            name={entry.displayName}
                            photoUrl={entry.photoUrl}
                            size={40}
                          />
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="subtitle2" noWrap>
                              {entry.displayName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {entry.memberNumber ?? 'GDG@PSU member'}
                            </Typography>
                          </Box>
                          <Chip
                            size="small"
                            label={`${entry.points} pts`}
                            color="primary"
                            variant="outlined"
                          />
                        </Stack>
                      ))}
                    </Stack>
                  )}
                  <Button
                    component="a"
                    href="/leaderboard"
                    fullWidth
                    sx={{ mt: 2.5 }}
                    endIcon={<ArrowForwardIcon />}
                  >
                    Full leaderboard
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 7, md: 9 } }}>
        <SectionHeading
          eyebrow="Upcoming"
          title="Show up. Tap in. Check out."
          description="Attendance is confirmed by an organizer at the door — a tap alone never awards points."
          action={
            <Button component="a" href="/events" endIcon={<ArrowForwardIcon />}>
              All events
            </Button>
          }
        />
        {events.length === 0 ? (
          <EmptyState
            title="Nothing on the calendar yet"
            description="The next workshop or build night will appear here as soon as it is published."
            action={
              <Button component="a" href="/leaderboard" variant="outlined">
                Browse the leaderboard
              </Button>
            }
          />
        ) : (
          <Grid container spacing={2.5}>
            {events.map((event) => (
              <Grid key={event.id} size={{ xs: 12, md: 4 }}>
                <Card
                  component="a"
                  href={`/events/${event.slug}`}
                  sx={{
                    display: 'block',
                    height: '100%',
                    textDecoration: 'none',
                    '&:hover': { borderColor: 'primary.main' },
                  }}
                >
                  <CardContent sx={{ p: 3 }}>
                    <Typography variant="overline" color="primary">
                      {formatDate(event.startsAt)}
                    </Typography>
                    <Typography variant="h4" sx={{ mt: 1, mb: 1 }}>
                      {event.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ minHeight: 48 }}>
                      {event.summary || 'Details coming soon.'}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center' }}>
                      <Chip size="small" label={formatTime(event.startsAt)} variant="outlined" />
                      {event.location ? (
                        <Chip size="small" label={event.location} variant="outlined" />
                      ) : null}
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Container>

      <Box
        sx={{
          bgcolor: 'surfaceMuted.main',
          py: { xs: 7, md: 9 },
          borderTop: '1px solid',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Container maxWidth="lg">
          <Grid container spacing={{ xs: 3, md: 5 }}>
            <Grid size={{ xs: 12, md: 4 }}>
              <Typography variant="overline" color="primary">
                How it works
              </Typography>
              <Typography variant="h2" sx={{ mt: 1 }}>
                Built for the people in the room.
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 8 }}>
              <Grid container spacing={2.5}>
                {[
                  {
                    icon: <NfcIcon />,
                    title: 'Your card is a doorway',
                    body: 'A tap opens your permanent profile. It never authorizes a check-in, a purchase or an account action.',
                  },
                  {
                    icon: <StarBorderOutlinedIcon />,
                    title: 'Stars are forever',
                    body: 'Every point you earn also becomes a star. Spend points on merch; stars stay as a record of showing up.',
                  },
                  {
                    icon: <EmojiEventsOutlinedIcon />,
                    title: 'No silent awards',
                    body: 'An organizer confirms check-in and check-out. Miss a checkout and no attendance points are granted.',
                  },
                ].map((item) => (
                  <Grid key={item.title} size={{ xs: 12, sm: 4 }}>
                    <Card sx={{ height: '100%', bgcolor: 'background.paper' }}>
                      <CardContent sx={{ p: 2.75 }}>
                        <Box sx={{ color: 'primary.main', mb: 1.5 }}>{item.icon}</Box>
                        <Typography variant="h5" sx={{ mb: 0.75 }}>
                          {item.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {item.body}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Grid>
          </Grid>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 7, md: 9 } }}>
        <Card sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', border: 0 }}>
          <CardContent sx={{ p: { xs: 3, md: 5 } }}>
            <Grid container spacing={3} sx={{ alignItems: 'center' }}>
              <Grid size={{ xs: 12, md: 8 }}>
                <Typography variant="h2" sx={{ color: 'inherit' }}>
                  Already a member?
                </Typography>
                <Typography sx={{ mt: 1, opacity: 0.9, maxWidth: 560 }}>
                  Sign in to see your points, stars, event history and your digital ID — or to pick
                  up something from the rewards shelf.
                </Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Stack direction={{ xs: 'column', sm: 'row', md: 'column' }} spacing={1.25}>
                  <Button
                    component="a"
                    href="/login"
                    variant="contained"
                    color="inherit"
                    sx={{ color: 'primary.main', bgcolor: 'common.white' }}
                    fullWidth
                  >
                    Sign in
                  </Button>
                  <Button component="a" href="/leaderboard" sx={{ color: 'inherit' }} fullWidth>
                    Leaderboard
                  </Button>
                </Stack>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      </Container>
    </>
  );
}
