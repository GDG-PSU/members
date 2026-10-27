'use client';

import Link from 'next/link';

import { usePathname } from 'next/navigation';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';

const links = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/invitations', label: 'Invitations' },
  { href: '/admin/members', label: 'Members' },
  { href: '/admin/cards', label: 'Cards' },
  { href: '/admin/events', label: 'Events' },
  { href: '/admin/kiosk', label: 'Kiosk' },
  { href: '/admin/rewards', label: 'Rewards' },
  { href: '/admin/devices', label: 'Devices' },
  { href: '/admin/audit', label: 'Audit' },
];

export function AdminNav() {
  const pathname = usePathname();
  const current =
    links
      .filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? '/admin';

  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', mb: { xs: 3, md: 4 } }}>
      <Tabs value={current} variant="scrollable" scrollButtons="auto" aria-label="Admin sections">
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
