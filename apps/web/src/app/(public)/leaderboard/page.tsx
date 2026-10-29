import Link from 'next/link';
import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { EmptyState, MemberAvatar, SectionHeading } from '@gdg/ui';
import { listLeaderboard } from '@/lib/public/queries';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Leaderboard',
  description: 'The GDG@PSU member leaderboard, built from verified event attendance.',
};

const podiumStyles = [
  { height: { xs: 0, md: 210 }, accent: 'star.main', order: 2 },
  { height: { xs: 0, md: 180 }, accent: 'text.secondary', order: 1 },
  { height: { xs: 0, md: 160 }, accent: 'secondary.main', order: 3 },
];

export default async function LeaderboardPage() {
  const entries = await listLeaderboard(100, 0).catch(() => []);
  const top = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <SectionHeading
        headingLevel={1}
        eyebrow="Semester standings"
        title="The leaderboard"
        description="Ranked by spendable points earned from confirmed attendance and organizer-recognized contributions. Stars are not part of the ranking."
      />

      {entries.length === 0 ? (
        <EmptyState
          title="No public rankings yet"
          description="Members choose whether to appear here. Once attendance is confirmed and a member opts in, the board fills up."
          action={
            <Button component="a" href="/events" variant="outlined">
              See upcoming events
            </Button>
          }
        />
      ) : (
        <>
          <Grid container spacing={2} sx={{ alignItems: 'flex-end', mb: 5 }}>
            {top.map((entry, index) => {
              const style = podiumStyles[index] ?? podiumStyles[2]!;
              return (
                <Grid key={entry.slug} size={{ xs: 12, md: 4 }} sx={{ order: { md: style.order } }}>
                  <Card
                    sx={{
                      position: 'relative',
                      minHeight: style.height,
                      display: 'flex',
                      alignItems: 'flex-end',
                      borderColor: index === 0 ? 'star.main' : 'divider',
                      borderTopWidth: index === 0 ? 4 : 1,
                    }}
                  >
                    <CardContent sx={{ p: 2.5, width: '100%' }}>
                      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                        <MemberAvatar
                          name={entry.displayName}
                          photoUrl={entry.photoUrl}
                          size={56}
                        />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="overline" sx={{ color: style.accent }}>
                            #{entry.rank}
                          </Typography>
                          <Typography variant="h5" noWrap>
                            <Link href={`/m/${entry.slug}`} style={{ textDecoration: 'none' }}>
                              {entry.displayName}
                            </Link>
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {entry.memberNumber ?? 'GDG@PSU member'}
                          </Typography>
                        </Box>
                        <Chip
                          label={`${entry.points} pts`}
                          color={index === 0 ? 'warning' : 'primary'}
                        />
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>

          <Card>
            <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
              <Box
                component="caption"
                sx={{
                  textAlign: 'left',
                  px: 2.5,
                  pt: 2,
                  typography: 'overline',
                  color: 'text.secondary',
                }}
              >
                Full ranking
              </Box>
              <Box component="thead">
                <Box component="tr" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                  {['Rank', 'Member', 'Member no.', 'Points'].map((header) => (
                    <Box
                      component="th"
                      key={header}
                      scope="col"
                      sx={{
                        textAlign: header === 'Points' ? 'right' : 'left',
                        px: 2.5,
                        py: 1.5,
                        typography: 'caption',
                        fontWeight: 700,
                        color: 'text.secondary',
                      }}
                    >
                      {header}
                    </Box>
                  ))}
                </Box>
              </Box>
              <Box component="tbody">
                {(rest.length > 0 ? rest : top).map((entry) => (
                  <Box
                    component="tr"
                    key={entry.slug}
                    sx={{
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      '&:last-child': { borderBottom: 0 },
                    }}
                  >
                    <Box
                      component="td"
                      sx={{
                        px: 2.5,
                        py: 1.75,
                        color: 'text.secondary',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {entry.rank}
                    </Box>
                    <Box component="td" sx={{ px: 2.5, py: 1.25 }}>
                      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                        <MemberAvatar
                          name={entry.displayName}
                          photoUrl={entry.photoUrl}
                          size={34}
                        />
                        <Typography
                          variant="subtitle2"
                          component="a"
                          href={`/m/${entry.slug}`}
                          sx={{ textDecoration: 'none' }}
                        >
                          {entry.displayName}
                        </Typography>
                      </Stack>
                    </Box>
                    <Box component="td" sx={{ px: 2.5, py: 1.75, color: 'text.secondary' }}>
                      {entry.memberNumber ?? '—'}
                    </Box>
                    <Box
                      component="td"
                      sx={{
                        px: 2.5,
                        py: 1.75,
                        textAlign: 'right',
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {entry.points}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Card>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            Only members who opted into the leaderboard and public points appear. Missing names are
            not zero-point members.
          </Typography>
        </>
      )}
    </Container>
  );
}
