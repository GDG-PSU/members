'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import {
  buttonVariants,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  ThemeModeToggle,
  Wordmark,
} from '@gdg/ui';

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

  const showAdmin = isSignedIn && isAdmin;
  const links = [
    ...publicLinks,
    ...(isSignedIn ? [{ href: '/member', label: 'My dashboard' }] : []),
  ];
  const mobileLinks = [...links, ...(showAdmin ? [{ href: '/admin', label: 'Admin' }] : [])];
  const onAuthPage =
    pathname === '/login' ||
    pathname === '/forgot-password' ||
    pathname === '/account/password' ||
    pathname === '/admin-mfa' ||
    pathname.startsWith('/invite/');

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const navItem = (active: boolean) =>
    cn(
      'relative flex h-12 items-center border-b-2 px-4 text-sm transition-colors',
      active
        ? 'border-[#0f62fe] bg-[#2c2c2c] font-semibold text-white'
        : 'border-transparent text-[#c6c6c6] hover:bg-[#2c2c2c] hover:text-white',
    );

  return (
    <header className="sticky top-0 z-40 border-b border-[#393939] bg-[#161616]">
      <div className="mx-auto flex h-12 w-full max-w-[1312px] items-center px-4 lg:px-8">
        <Link
          href="/"
          aria-label="MemberPass home"
          className="flex h-12 shrink-0 items-center pr-4 text-white transition-opacity hover:opacity-90"
        >
          <Wordmark compact />
        </Link>

        <nav aria-label="Primary" className="hidden h-12 items-stretch md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? 'page' : undefined}
              className={navItem(isActive(link.href))}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ThemeModeToggle inverse className="mr-1 hidden md:inline-flex" />
          {showAdmin ? (
            <Link
              href="/admin"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'sm' }),
                'hidden text-white hover:bg-white/10 hover:text-white sm:inline-flex',
              )}
            >
              Admin
            </Link>
          ) : null}
          {isSignedIn ? (
            <>
              <span className="hidden max-w-[9rem] truncate px-2 text-xs text-[#c6c6c6] lg:block">
                {displayName ?? (isAdmin ? 'Organizer' : 'Member')}
              </span>
              <form action="/api/auth/signout" method="post" className="hidden sm:block">
                <button
                  type="submit"
                  className={cn(
                    buttonVariants({ variant: 'ghost', size: 'sm' }),
                    'text-white hover:bg-white/10 hover:text-white',
                  )}
                >
                  Sign out
                </button>
              </form>
            </>
          ) : onAuthPage ? null : (
            <Link
              href="/login"
              className={cn(buttonVariants({ size: 'sm' }), 'hidden sm:inline-flex')}
            >
              Sign in
            </Link>
          )}

          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="grid size-10 place-items-center text-white transition-colors hover:bg-[#2c2c2c] md:hidden"
          >
            <Menu className="size-5" />
          </button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="left-auto right-0 top-0 h-dvh w-[84vw] max-w-xs translate-x-0 translate-y-0 border-0 bg-[#161616] p-4 text-white"
          showClose={false}
        >
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <div className="flex h-10 items-center justify-between border-b border-white/20">
            <Wordmark compact />
            <DialogClose
              aria-label="Close navigation"
              className="grid size-9 place-items-center text-[#c6c6c6] transition-colors hover:bg-[#2c2c2c] hover:text-white"
            >
              <X className="size-4" />
            </DialogClose>
          </div>

          <nav aria-label="Mobile navigation" className="mt-4">
            <ul>
              {mobileLinks.map((link) => {
                const active = isActive(link.href);
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(navItem(active), 'w-full')}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="mt-4 border-t border-white/20 pt-4">
            <p className="mb-2 text-xs leading-4 tracking-[0.32px] text-[#c6c6c6] uppercase">
              Theme
            </p>
            <ThemeModeToggle inverse />
          </div>

          <div className="mt-4 border-t border-white/20 pt-4">
            {isSignedIn ? (
              <form action="/api/auth/signout" method="post">
                <button
                  type="submit"
                  className={cn(
                    buttonVariants({ variant: 'ghost' }),
                    'w-full justify-start text-white hover:bg-white/10 hover:text-white',
                  )}
                >
                  Sign out
                </button>
              </form>
            ) : onAuthPage ? null : (
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className={cn(buttonVariants({}), 'w-full')}
              >
                Sign in
              </Link>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
