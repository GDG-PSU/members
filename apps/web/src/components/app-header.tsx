'use client';

import Link from 'next/link';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import { ThemeModeToggle, Wordmark } from '@gdg/ui';

const publicLinks = [
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/events', label: 'Events' },
];

export function AppHeader({
  displayName,
  isAdmin,
  isSignedIn,
}: {
  displayName: string | null;
  isAdmin: boolean;
  isSignedIn: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = [
    ...publicLinks,
    ...(isSignedIn ? [{ href: '/member', label: 'My dashboard' }] : []),
    ...(isAdmin ? [{ href: '/admin', label: 'Admin' }] : []),
  ];

  const nav = (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 0.5, md: 0.5 }}>
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Button
            key={link.href}
            component={Link}
            href={link.href}
            color={active ? 'primary' : 'inherit'}
            aria-current={active ? 'page' : undefined}
            sx={{
              justifyContent: { xs: 'flex-start', md: 'center' },
              fontWeight: active ? 700 : 550,
              bgcolor: active ? 'action.selected' : 'transparent',
              px: 1.75,
            }}
          >
            {link.label}
          </Button>
        );
      })}
    </Stack>
  );

  return (
    <AppBar
      position="sticky"
      color="transparent"
      sx={{
        borderBottom: '1px solid',
        borderColor: 'divider',
        backdropFilter: 'saturate(150%) blur(14px)',
        bgcolor: 'rgba(255,255,255,0.02)',
        zIndex: (theme) => theme.zIndex.appBar,
      }}
    >
      <Container maxWidth="lg">
        <Toolbar disableGutters sx={{ minHeight: { xs: 64, md: 72 }, gap: 2 }}>
          <Box
            component={Link}
            href="/"
            aria-label="GDG@PSU home"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <Box
              aria-hidden
              sx={{
                width: 10,
                height: 10,
                borderRadius: '3px',
                background: 'linear-gradient(135deg, #1450a3 0%, #0f766e 100%)',
              }}
            />
            <Wordmark />
          </Box>

          <Box sx={{ display: { xs: 'none', md: 'flex' }, ml: 2 }}>{nav}</Box>
          <Box sx={{ flexGrow: 1 }} />
          <ThemeModeToggle />
          <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 1 }}>
            {isSignedIn ? (
              <>
                <Typography variant="body2" sx={{ maxWidth: 140, fontWeight: 600 }} noWrap>
                  {displayName ?? 'Member'}
                </Typography>
                <form action="/api/auth/signout" method="post">
                  <Button type="submit" size="small" color="inherit">
                    Sign out
                  </Button>
                </form>
              </>
            ) : (
              <Button component={Link} href="/login" size="small" variant="contained">
                Member sign in
              </Button>
            )}
          </Box>
          <IconButton
            sx={{ display: { md: 'none' } }}
            aria-label="Open navigation"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <MenuIcon />
          </IconButton>
        </Toolbar>
      </Container>

      <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
        <Box sx={{ width: 288, p: 2 }} role="navigation" aria-label="Mobile navigation">
          <Stack
            direction="row"
            sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}
          >
            <Wordmark compact />
            <IconButton aria-label="Close navigation" onClick={() => setOpen(false)}>
              <CloseIcon />
            </IconButton>
          </Stack>
          <Divider sx={{ mb: 1 }} />
          <List>
            {links.map((link) => (
              <ListItemButton
                key={link.href}
                component={Link}
                href={link.href}
                selected={pathname === link.href || pathname.startsWith(`${link.href}/`)}
                onClick={() => setOpen(false)}
              >
                <ListItemText primary={link.label} />
              </ListItemButton>
            ))}
          </List>
          <Divider sx={{ my: 1 }} />
          {isSignedIn ? (
            <form action="/api/auth/signout" method="post">
              <Button type="submit" fullWidth color="inherit">
                Sign out
              </Button>
            </form>
          ) : (
            <Button
              component={Link}
              href="/login"
              fullWidth
              variant="contained"
              onClick={() => setOpen(false)}
            >
              Member sign in
            </Button>
          )}
        </Box>
      </Drawer>
    </AppBar>
  );
}
