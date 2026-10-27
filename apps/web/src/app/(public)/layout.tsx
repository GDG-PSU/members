import Box from '@mui/material/Box';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <Box component="main">{children}</Box>;
}
