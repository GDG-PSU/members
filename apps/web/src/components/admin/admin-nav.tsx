import { NavTabs } from '@/components/nav-tabs';

export function AdminNav({ isSuperadmin }: { isSuperadmin: boolean }) {
  const links = [
    { href: '/admin', label: 'Overview' },
    { href: '/admin/invitations', label: 'Invitations' },
    { href: '/admin/users', label: 'Users', activePrefixes: ['/admin/members'] },
    { href: '/admin/cards', label: 'Cards' },
    { href: '/admin/events', label: 'Events' },
    { href: '/admin/kiosk', label: 'Kiosk' },
    { href: '/admin/rewards', label: 'Rewards' },
    ...(isSuperadmin ? [{ href: '/admin/audit', label: 'Audit' }] : []),
  ];

  return <NavTabs items={links} ariaLabel="Admin sections" />;
}
