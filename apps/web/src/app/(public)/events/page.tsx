import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import EventOutlinedIcon from '@mui/icons-material/EventOutlined';
import { EmptyState, SectionHeading } from '@gdg/ui';
import { listPublicEvents } from '@/lib/public/queries';
import { formatDate, formatTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Events',
  description: 'Workshops, build nights and community events from GDG@PSU.',
};

export default async function EventsPage() {
  const events = await listPublicEvents(60).catch(() => []);

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <SectionHeading
        headingLevel={1}
        eyebrow="Calendar"
        title="Come build with us"
        description="Each event has a main session worth attendance points. Bonus sessions (like a study block) require their own check-in and check-out."
      />

      {events.length === 0 ? (
        <EmptyState
          title="No published events yet"
          description="Organizers publish each event here. Check back soon or follow GDG@PSU."
          icon={<EventOutlinedIcon fontSize="large" />}
        />
      ) : (
        <Stack spacing={1.5}>
          {events.map((event) => {
            const upcoming = new Date(event.endsAt) >= new Date();
            return (
              <Card
                key={event.id}
                component="a"
                href={`/events/${event.slug}`}
                sx={{
                  display: 'block',
                  textDecoration: 'none',
                  borderLeft: '4px solid',
                  borderLeftColor: upcoming ? 'primary.main' : 'divider',
                  '&:hover': { borderColor: 'primary.main' },
                }}
              >
                <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={{ xs: 1.5, md: 3 }}
                    sx={{ alignItems: { md: 'center' } }}
                  >
                    <Box sx={{ minWidth: { md: 132 } }}>
                      <Typography
                        variant="overline"
                        color={upcoming ? 'primary' : 'text.secondary'}
                      >
                        {upcoming ? 'Upcoming' : 'Past'}
                      </Typography>
                      <Typography variant="h5">{formatDate(event.startsAt)}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatTime(event.startsAt)} – {formatTime(event.endsAt)}
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="h4" sx={{ mb: 0.5 }}>
                        {event.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {event.summary || 'Details coming soon.'}
                      </Typography>
                    </Box>
                    {event.location ? (
                      <Chip label={event.location} variant="outlined" size="small" />
                    ) : null}
                    <Button
                      endIcon={<EventOutlinedIcon />}
                      size="small"
                      sx={{ alignSelf: { xs: 'flex-start', md: 'center' } }}
                    >
                      Details
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}
    </Container>
  );
}
