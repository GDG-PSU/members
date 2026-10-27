import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import { MemberNav } from '@/components/member/member-nav';

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box component="main" id="main">
      <Container maxWidth="lg" sx={{ pt: { xs: 2, md: 3 } }}>
        <MemberNav />
      </Container>
      {children}
    </Box>
  );
}
