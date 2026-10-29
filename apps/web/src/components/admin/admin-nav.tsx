import { NavTabs } from '@/components/nav-tabs';

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
  return <NavTabs items={links} ariaLabel="Admin sections" />;
}
