'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@gdg/ui';

export function NavTabs({
  items,
  ariaLabel,
  className,
}: {
  /** `exact` keeps a section's first page from lighting up on every page under it. */
  items: { href: string; label: string; exact?: boolean; activePrefixes?: string[] }[];
  ariaLabel: string;
  className?: string;
}) {
  const pathname = usePathname();
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  const active = items
    .filter(
      (item) =>
        (item.exact ? pathname === item.href : under(item.href)) ||
        (item.activePrefixes ?? []).some(under),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav
      aria-label={ariaLabel}
      className={cn('scrollbar-none overflow-x-auto border-b border-border', className)}
    >
      <ul className="flex min-w-max items-stretch">
        {items.map((item) => {
          const isActive = item.href === active;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative inline-flex h-12 items-center px-4 text-sm transition-colors',
                  isActive
                    ? 'font-semibold text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {item.label}
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-x-0 -bottom-px h-0.5 bg-foreground transition-opacity',
                    isActive ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
