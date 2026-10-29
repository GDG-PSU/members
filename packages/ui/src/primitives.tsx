import type { ReactNode } from 'react';
import { cn } from './lib/cn';

const pageWidths = {
  sm: 'max-w-xl',
  md: 'max-w-3xl',
  lg: 'max-w-5xl',
  xl: 'max-w-6xl',
} as const;

export function PageShell({
  children,
  className,
  width = 'xl',
}: {
  children: ReactNode;
  className?: string;
  width?: keyof typeof pageWidths;
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 py-8 sm:px-6 sm:py-10 lg:px-8',
        pageWidths[width],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-card">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
      />
      <div className="flex items-center gap-2 text-muted-foreground [&_svg]:size-4">
        {icon}
        <span className="type-overline text-muted-foreground">{label}</span>
      </div>
      <p className="mt-2 text-[2rem] font-extrabold leading-none tracking-[-0.035em] tabular-nums md:text-[2.35rem]">
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const statusTone = {
  active: 'success',
  completed: 'success',
  confirmed: 'success',
  written: 'success',
  fulfilled: 'success',
  qualified: 'success',
  approved: 'primary',
  claimed: 'primary',
  checked_in: 'primary',
  published: 'primary',
  requested: 'warning',
  pending: 'warning',
  queued: 'warning',
  suspended: 'warning',
  draft: 'neutral',
  cancelled: 'neutral',
  expired: 'neutral',
  replaced: 'neutral',
  archived: 'neutral',
  rejected: 'danger',
  revoked: 'danger',
  lost: 'danger',
  disabled: 'danger',
  failed: 'danger',
} as const;

const toneStyles = {
  success: 'border-success/25 bg-success/10 text-success',
  primary: 'border-primary/20 bg-primary-soft text-primary',
  warning: 'border-warning/25 bg-warning/10 text-warning',
  danger: 'border-danger/25 bg-danger/10 text-danger',
  neutral: 'border-border bg-muted text-muted-foreground',
} as const;

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const tone = statusTone[status as keyof typeof statusTone] ?? 'neutral';
  const text = label ?? status.replaceAll('_', ' ');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[0.72rem] font-semibold capitalize leading-5',
        toneStyles[tone],
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-75" />
      {text}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-subtle px-6 py-12 text-center">
      {icon ? (
        <span className="grid size-11 place-items-center rounded-full border border-border bg-card text-muted-foreground [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <h3 className="type-h3 text-foreground">{title}</h3>
      {description ? (
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-border border-t-primary"
      />
      {label}…
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div aria-hidden className="space-y-3 py-4">
      <div className="h-10 w-[45%] animate-pulse rounded-xl bg-muted" />
      <div className="h-48 animate-pulse rounded-2xl bg-muted" />
      <div className="h-28 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-danger/30 border-l-4 border-l-danger bg-card p-5 shadow-card"
    >
      <h2 className="text-base font-bold">{title}</h2>
      {description ? (
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
