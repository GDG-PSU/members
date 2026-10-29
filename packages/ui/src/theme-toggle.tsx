'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from './lib/cn';

type Mode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'memberpass-theme';

const options = [
  { value: 'system' as const, label: 'System theme', icon: Monitor },
  { value: 'light' as const, label: 'Light theme', icon: Sun },
  { value: 'dark' as const, label: 'Dark theme', icon: Moon },
];

function applyMode(mode: Mode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = mode === 'dark' || (mode === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

export function ThemeModeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<Mode>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initial: Mode = stored === 'light' || stored === 'dark' ? stored : 'system';
    setMode(initial);
    setMounted(true);
    applyMode(initial);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (mode === 'system') applyMode('system');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode, mounted]);

  function choose(next: Mode) {
    setMode(next);
    applyMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable in private contexts; the visual choice still applies.
    }
  }

  return (
    <div
      role="group"
      aria-label="Color theme"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-card',
        className,
      )}
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = mounted && mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.label}
            aria-label={option.label}
            aria-pressed={active}
            onClick={() => choose(option.value)}
            className={cn(
              'grid size-8 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-primary-soft text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
