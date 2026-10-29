import { NavTabs } from '@/components/nav-tabs';

const links = [
  { href: '/member', label: 'Overview' },
  { href: '/member/activity', label: 'Activity' },
  { href: '/member/rewards', label: 'Rewards' },
  { href: '/member/profile', label: 'Profile' },
  { href: '/member/privacy', label: 'Privacy' },
  { href: '/member/id', label: 'Digital ID' },
];

export function MemberNav() {
  return <NavTabs items={links} ariaLabel="Member sections" />;
}
