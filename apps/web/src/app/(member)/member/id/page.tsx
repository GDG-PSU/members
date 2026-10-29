import type { Metadata } from 'next';
import QRCode from 'qrcode';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import { EmptyState, StatusChip } from '@gdg/ui';
import { requireMember } from '@/lib/auth/viewer';
import { getActiveCardUrl, getCardStatus } from '@/lib/member/queries';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Digital ID',
  robots: { index: false, follow: false },
};

export default async function DigitalIdPage() {
  const { member, supabase } = await requireMember();
  const [cardUrl, card] = await Promise.all([
    getActiveCardUrl(supabase, member.id),
    getCardStatus(supabase, member.id),
  ]);

  const qr =
    cardUrl !== null
      ? await QRCode.toDataURL(cardUrl, {
          width: 640,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#0b1220', light: '#ffffff' },
        })
      : null;

  return (
    <Container maxWidth="sm" sx={{ pb: { xs: 6, md: 9 } }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography variant="overline" color="primary">
          Fallback identification
        </Typography>
        <Typography variant="h2" component="h1" sx={{ fontSize: { xs: '2rem', md: '2.6rem' } }}>
          Your digital ID
        </Typography>
        <Typography color="text.secondary">
          Show this to an organizer if your card is unavailable. It opens your public profile — it
          is not a password and does not authorize attendance by itself.
        </Typography>
      </Stack>

      <Card>
        <CardContent sx={{ p: 3.5 }}>
          {qr ? (
            <Stack spacing={2.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
              <Chip icon={<BadgeOutlinedIcon />} label={member.publicNumber} variant="outlined" />
              <Box
                component="img"
                src={qr}
                alt={`QR code linking to ${member.displayName}'s GDG@PSU profile`}
                sx={{
                  width: '100%',
                  maxWidth: 320,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              />
              <Typography variant="h5">{member.displayName}</Typography>
              <StatusChip status="active" label="Active card" />
              <Typography variant="caption" color="text.secondary">
                This screen is only visible while signed in. Do not post it publicly.
              </Typography>
            </Stack>
          ) : (
            <EmptyState
              title={card.status === 'pending' ? 'Your card is queued' : 'No active card yet'}
              description={
                card.status === 'pending'
                  ? 'An organizer has prepared your card but has not written it yet. Your digital ID unlocks automatically once the write is verified.'
                  : 'Ask an organizer to issue a card at the next event. Your profile link already works without one.'
              }
              action={
                <Button component="a" href={`/m/${member.slug}`} variant="outlined">
                  Open public profile
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
