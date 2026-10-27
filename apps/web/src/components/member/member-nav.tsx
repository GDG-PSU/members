'use client';

import Link from 'next/link';

import { usePathname } from 'next/navigation';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';

const links = [
  { href: '/member', label: 'Overview' },
  { href: '/member/activity', label: 'Activity' },
  { href: '/member/rewards', label: 'Rewards' },
  { href: '/member/profile', label: 'Profile' },
  { href: '/member/privacy', label: 'Privacy' },
  { href: '/member/id', label: 'Digital ID' },
];

export function MemberNav() {
  const pathname = usePathname();
  const current = links.find((link) => link.href === pathname)?.href ?? '/member';

  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', mb: { xs: 3, md: 5 } }}>
      <Tabs
        value={current}
        variant="scrollable"
        scrollButtons="auto"
        aria-label="Member sections"
        sx={{ minHeight: 48 }}
      >
        {links.map((link) => (
          <Tab
            key={link.href}
            value={link.href}
            label={link.label}
            component={Link}
            href={link.href}
            sx={{ minHeight: 48, fontWeight: 600 }}
          />
        ))}
      </Tabs>
    </Box>
  );
}
