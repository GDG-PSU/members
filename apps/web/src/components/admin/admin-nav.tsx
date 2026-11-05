import { NavTabs } from '@/components/nav-tabs';

// The kiosk opens from an event and the full history from Home, so each sits
// under the tab that leads to it.
const links = [
  { href: '/admin', label: 'Home', exact: true, activePrefixes: ['/admin/audit'] },
  {
    href: '/admin/users',
    label: 'People',
    activePrefixes: ['/admin/members', '/admin/staff', '/admin/invitations'],
  },
  { href: '/admin/cards', label: 'Cards' },
  { href: '/admin/events', label: 'Events', activePrefixes: ['/admin/kiosk'] },
  { href: '/admin/rewards', label: 'Rewards' },
];

export function AdminNav() {
  return <NavTabs items={links} ariaLabel="Admin sections" />;
}
