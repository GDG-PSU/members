import { NavTabs } from '@/components/nav-tabs';

const links = [
  { href: '/member', label: 'Home', exact: true, activePrefixes: ['/member/id'] },
  { href: '/member/activity', label: 'Activity' },
  { href: '/member/rewards', label: 'Rewards' },
  { href: '/member/profile', label: 'Profile', activePrefixes: ['/member/privacy'] },
];

export function MemberNav() {
  return <NavTabs items={links} ariaLabel="Member sections" />;
}
