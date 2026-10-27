import Link from 'next/link';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Wordmark } from '@gdg/ui';
import { SUPPORT_EMAIL } from '@/lib/env';

export function AppFooter() {
  return (
    <Box component="footer" sx={{ mt: 8, borderTop: '1px solid', borderColor: 'divider' }}>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
        >
          <Box>
            <Wordmark compact />
            <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
              Google Developer Group at Penn State · Student-run community
            </Typography>
          </Box>
          <Stack direction="row" spacing={2.5} sx={{ flexWrap: 'wrap' }}>
            <Link href="/events" style={{ textDecoration: 'none' }}>
              <Typography variant="caption" color="text.secondary">
                Events
              </Typography>
            </Link>
            <Link href="/privacy" style={{ textDecoration: 'none' }}>
              <Typography variant="caption" color="text.secondary">
                Privacy
              </Typography>
            </Link>
            <Typography variant="caption" color="text.secondary">
              Support: {SUPPORT_EMAIL}
            </Typography>
          </Stack>
        </Stack>
        <Divider sx={{ my: 3 }} />
        <Typography variant="caption" color="text.secondary">
          Card links are identifiers, not credentials. Attendance always requires a human check-in and
          check-out.
        </Typography>
      </Container>
    </Box>
  );
}
