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

  const links = [
    ...publicLinks,
    ...(isSignedIn ? [{ href: '/member', label: 'My dashboard' }] : []),
    ...(isAdmin ? [{ href: '/admin', label: 'Admin' }] : []),
  ];
  const onAuthPage =
    pathname === '/login' ||
    pathname === '/forgot-password' ||
    pathname === '/account/password' ||
    pathname === '/admin-mfa' ||
    pathname.startsWith('/invite/');

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:px-6 md:h-[4.5rem] lg:px-8">
        <Link
          href="/"
          aria-label="MemberPass home"
          className="flex shrink-0 items-center rounded-lg pr-1 transition-opacity hover:opacity-80"
        >
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 md:flex">
          {links.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-9 items-center rounded-full px-3.5 text-sm transition-colors',
                  active
                    ? 'bg-primary-soft font-bold text-primary'
                    : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeModeToggle className="hidden md:inline-flex" />
          {isSignedIn ? (
            <>
              <span className="hidden max-w-[9rem] truncate text-sm font-semibold lg:block">
                {displayName ?? (isAdmin ? 'Organizer' : 'Member')}
              </span>
              <form action="/api/auth/signout" method="post" className="hidden sm:block">
                <button
                  type="submit"
                  className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
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
            className="grid size-10 place-items-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted md:hidden"
          >
            <Menu className="size-5" />
          </button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="left-auto right-0 top-0 h-dvh w-[84vw] max-w-xs translate-x-0 translate-y-0 rounded-none rounded-l-3xl border-y-0 border-r-0 p-5"
          showClose={false}
        >
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <div className="flex items-center justify-between">
            <Wordmark compact />
            <DialogClose
              aria-label="Close navigation"
              className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </DialogClose>
          </div>

          <nav aria-label="Mobile navigation" className="mt-6">
            <ul className="space-y-1">
              {links.map((link) => {
                const active = isActive(link.href);
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-11 items-center rounded-xl px-3.5 text-sm transition-colors',
                        active
                          ? 'bg-primary-soft font-bold text-primary'
                          : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="mt-6 border-t border-border pt-5">
            <p className="type-overline mb-2 text-muted-foreground">Theme</p>
            <ThemeModeToggle />
          </div>

          <div className="mt-6 border-t border-border pt-5">
            {isSignedIn ? (
              <form action="/api/auth/signout" method="post">
                <button
                  type="submit"
                  className={cn(buttonVariants({ variant: 'secondary' }), 'w-full')}
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
