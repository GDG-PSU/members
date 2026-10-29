'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@gdg/ui';

export function NavTabs({
  items,
  ariaLabel,
  className,
}: {
  items: { href: string; label: string }[];
  ariaLabel: string;
  className?: string;
}) {
  const pathname = usePathname();
  const active = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav
      aria-label={ariaLabel}
      className={cn('scrollbar-none -mx-1 overflow-x-auto border-b border-border', className)}
    >
      <ul className="flex min-w-max items-stretch gap-1 px-1">
        {items.map((item) => {
          const isActive = item.href === active;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative inline-flex h-12 items-center px-3.5 text-sm font-semibold transition-colors hover:text-foreground',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {item.label}
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary transition-opacity',
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
