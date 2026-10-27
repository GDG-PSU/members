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
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import { getPublicEvent } from '@/lib/public/queries';
import { formatDate, formatTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublicEvent(slug).catch(() => null);
  return {
    title: data?.event.name ?? 'Event',
    description: data?.event.summary ?? undefined,
  };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getPublicEvent(slug);
  if (!data) notFound();
  const { event, sessions } = data;
  const main = sessions.find((session) => session.kind === 'main');
  const bonus = sessions.filter((session) => session.kind === 'bonus');

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <Button component="a" href="/events" size="small" sx={{ mb: 3 }}>
        ← All events
      </Button>
      <Grid container spacing={{ xs: 4, md: 6 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Chip label={formatDate(event.startsAt)} color="primary" size="small" sx={{ mb: 2 }} />
          <Typography variant="h1" sx={{ fontSize: { xs: '2.5rem', md: '3.8rem' } }}>
            {event.name}
          </Typography>
          <Typography variant="subtitle1" color="text.secondary" sx={{ mt: 2, maxWidth: 620 }}>
            {event.summary || 'Details will be shared by the organizers.'}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ mt: 3, flexWrap: 'wrap', rowGap: 1 }}>
            <Chip
              icon={<PlaceOutlinedIcon />}
              label={event.location || 'Location to be announced'}
              variant="outlined"
            />
            <Chip label={`${formatTime(event.startsAt)} – ${formatTime(event.endsAt)}`} variant="outlined" />
          </Stack>

          <Box sx={{ mt: 5 }}>
            <Typography variant="h3" sx={{ mb: 2 }}>
              Sessions
            </Typography>
            <Stack spacing={1.5}>
              {main ? (
                <Card>
                  <CardContent sx={{ p: 2.5 }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
                      <Box>
                        <Typography variant="overline" color="primary">
                          Main session
                        </Typography>
                        <Typography variant="h5">{main.name}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {formatTime(main.startsAt)} – {formatTime(main.endsAt)} · Check out to qualify
                        </Typography>
                      </Box>
                      <Chip
                        icon={<StarBorderOutlinedIcon />}
                        label={`+${main.rewardPoints} pts`}
                        color="warning"
                        variant="outlined"
                      />
                    </Stack>
                  </CardContent>
                </Card>
              ) : null}
              {bonus.map((session) => (
                <Card key={session.id}>
                  <CardContent sx={{ p: 2.5 }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
                      <Box>
                        <Typography variant="overline" color="secondary">
                          Bonus session
                        </Typography>
                        <Typography variant="h6">{session.name}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {formatTime(session.startsAt)} – {formatTime(session.endsAt)} · Requires its own
                          check-in and check-out
                        </Typography>
                      </Box>
                      <Chip label={`+${session.rewardPoints} pts`} variant="outlined" />
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          </Box>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ position: { md: 'sticky' }, top: { md: 96 } }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h5" sx={{ mb: 1 }}>
                How attendance works
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Tap your member card at the organizer&apos;s kiosk, then confirm with the organizer:
              </Typography>
              <Stack spacing={1.5} sx={{ my: 2.5 }}>
                {[
                  'Organizer confirms your check-in.',
                  'Stay for the session.',
                  'Organizer confirms your check-out.',
                  'Points and a matching star are added only if you met the minimum duration.',
                ].map((step, index) => (
                  <Stack key={step} direction="row" spacing={1.25}>
                    <Box
                      sx={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 12,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {index + 1}
                    </Box>
                    <Typography variant="body2">{step}</Typography>
                  </Stack>
                ))}
              </Stack>
              <Divider sx={{ my: 2 }} />
              <Typography variant="caption" color="text.secondary">
                No checkout means no attendance points. If something goes wrong, email GDG@PSU from your
                registered address and an organizer can review it.
              </Typography>
              <Button component="a" href="/login" fullWidth variant="contained" sx={{ mt: 2.5 }}>
                Member sign in
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
