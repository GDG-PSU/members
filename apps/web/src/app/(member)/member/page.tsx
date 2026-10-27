import type { Metadata } from 'next';
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
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import StarBorderOutlinedIcon from '@mui/icons-material/StarBorderOutlined';
import NfcIcon from '@mui/icons-material/Nfc';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import { EmptyState, MemberAvatar, MetricCard, StatusChip } from '@gdg/ui';
import { requireMember } from '@/lib/auth/viewer';
import { getBalances, getCardStatus, getRecentAttendance, getLedger } from '@/lib/member/queries';
import { publicPhotoUrl } from '@/lib/profile/photo';
import { formatDate, formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My dashboard',
  robots: { index: false, follow: false },
};

export default async function MemberDashboard({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { member, supabase, user } = await requireMember();
  const { welcome } = await searchParams;

  const [balances, attendance, ledger, card, nextEvent] = await Promise.all([
    getBalances(supabase, member.id),
    getRecentAttendance(supabase, member.id, 4),
    getLedger(supabase, member.id, 4),
    getCardStatus(supabase, member.id),
    supabase
      .from('events')
      .select('name, slug, starts_at, location')
      .eq('status', 'published')
      .gte('ends_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const attendedCount = attendance.filter((row) => row.qualified).length;
  const cardLabel =
    card.status === 'active'
      ? 'Active'
      : card.status === 'pending'
        ? 'Awaiting write'
        : card.status === 'none'
          ? 'Not issued yet'
          : card.status.replace('_', ' ');

  return (
    <Container maxWidth="lg" sx={{ pb: { xs: 6, md: 9 } }}>
      {welcome ? (
        <Box
          sx={{
            mb: 3,
            p: 2.5,
            borderRadius: 3,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
          }}
          role="status"
        >
          <Typography variant="h5" sx={{ color: 'inherit' }}>
            You&apos;re in, {member.displayName.split(' ')[0]}.
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.9 }}>
            Your permanent profile is live at /m/{member.slug}. Your card will appear here once an
            organizer writes it.
          </Typography>
        </Box>
      ) : null}

      <Grid container spacing={{ xs: 3, md: 4 }}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} sx={{ alignItems: { sm: 'center' }, mb: 4 }}>
            <MemberAvatar
              name={member.displayName}
              photoUrl={publicPhotoUrl(member.photoPath)}
              size={72}
            />
            <Box sx={{ flex: 1 }}>
              <Typography variant="overline" color="text.secondary">
                Member since {formatDate(member.memberSince)}
              </Typography>
              <Typography variant="h2" component="h1" sx={{ fontSize: { xs: '2rem', md: '2.6rem' } }}>
                {member.displayName}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {member.publicNumber} · {user.email}
              </Typography>
            </Box>
            <Button component="a" href={`/m/${member.slug}`} variant="outlined" size="small">
              View public profile
            </Button>
          </Stack>

          <Grid container spacing={2} sx={{ mb: 4 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <MetricCard
                label="Spendable points"
                value={balances.points}
                hint="Use these on rewards"
                icon={<EmojiEventsOutlinedIcon fontSize="small" />}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <MetricCard
                label="Lifetime stars"
                value={balances.stars}
                hint="Never spent"
                icon={<StarBorderOutlinedIcon fontSize="small" />}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <MetricCard
                label="Qualified sessions"
                value={attendedCount}
                hint="Recent sessions shown"
                icon={<BadgeOutlinedIcon fontSize="small" />}
              />
            </Grid>
          </Grid>

          <Card sx={{ mb: 4 }}>
            <CardContent sx={{ p: 3 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h5">Recent activity</Typography>
                <Button component="a" href="/member/activity" size="small" endIcon={<ArrowForwardIcon />}>
                  All activity
                </Button>
              </Stack>
              {attendance.length === 0 && ledger.length === 0 ? (
                <EmptyState
                  title="Your history starts at the next event"
                  description="Tap in with an organizer, stay for the session, then check out. Points land after both confirmations."
                />
              ) : (
                <Stack spacing={1.5} divider={<Divider flexItem />}>
                  {attendance.slice(0, 2).map((row) => (
                    <Stack key={row.id} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle2" noWrap>
                          {row.eventName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDateTime(row.checkedInAt)} · {row.sessionName}
                          {row.sessionKind === 'bonus' ? ' (bonus)' : ''}
                        </Typography>
                      </Box>
                      {row.qualified ? (
                        <Chip size="small" color="warning" label={`+${row.rewardPoints} pts`} />
                      ) : (
                        <StatusChip status={row.state} />
                      )}
                    </Stack>
                  ))}
                  {ledger.slice(0, 2).map((row) => (
                    <Stack key={`ledger-${row.id}`} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle2" noWrap>
                          {row.description}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDateTime(row.createdAt)}
                        </Typography>
                      </Box>
                      <Typography
                        variant="subtitle2"
                        sx={{ color: row.delta > 0 ? 'success.main' : 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                      >
                        {row.delta > 0 ? '+' : ''}
                        {row.delta}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={2.5}>
            <Card>
              <CardContent sx={{ p: 3 }}>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <NfcIcon fontSize="small" color="primary" />
                  <Typography variant="h5">Your card</Typography>
                </Stack>
                <StatusChip
                  status={card.status === 'none' ? 'pending' : card.status}
                  label={cardLabel}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                  {card.status === 'active'
                    ? 'Tap your card at any organizer kiosk. The card only opens your profile — staff still confirm attendance.'
                    : card.status === 'pending'
                      ? 'An organizer has queued your card. Bring it to the next event to be written.'
                      : 'No card has been issued yet. Your digital ID becomes available once a card is active.'}
                </Typography>
                <Button
                  component="a"
                  href="/member/id"
                  fullWidth
                  variant="contained"
                  sx={{ mt: 2 }}
                  disabled={card.status !== 'active'}
                >
                  Show digital ID
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h5" sx={{ mb: 1 }}>
                  Next up
                </Typography>
                {nextEvent.data ? (
                  <>
                    <Typography variant="subtitle2">{nextEvent.data.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatDateTime(nextEvent.data.starts_at)}
                      {nextEvent.data.location ? ` · ${nextEvent.data.location}` : ''}
                    </Typography>
                    <Button
                      component="a"
                      href={`/events/${nextEvent.data.slug}`}
                      size="small"
                      sx={{ mt: 1.5, px: 0 }}
                      endIcon={<ArrowForwardIcon />}
                    >
                      Event details
                    </Button>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No published events right now. Check back soon.
                  </Typography>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h5" sx={{ mb: 1 }}>
                  Redeem points
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Merch and perks from the GDG@PSU shelf. Stars stay untouched when you spend.
                </Typography>
                <Button component="a" href="/member/rewards" fullWidth variant="outlined">
                  Browse rewards
                </Button>
              </CardContent>
            </Card>
          </Stack>
        </Grid>
      </Grid>
    </Container>
  );
}
