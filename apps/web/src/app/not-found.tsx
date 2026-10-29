import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

export default function NotFound() {
  return (
    <Box sx={{ maxWidth: 560, mx: 'auto', px: 3, py: 12, textAlign: 'center' }}>
      <Typography variant="overline" color="primary">
        404
      </Typography>
      <Typography variant="h2" sx={{ mb: 1.5 }}>
        This page is not here
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        The link may have expired, the member may have made their profile private, or a card may
        have been replaced.
      </Typography>
      <Button component="a" href="/" variant="contained">
        Back to GDG@PSU
      </Button>
    </Box>
  );
}
