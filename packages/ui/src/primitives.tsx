import type { ReactNode } from 'react';
import { cn } from './lib/cn';

const pageWidths = {
  sm: 'max-w-[512px]',
  md: 'max-w-[672px]',
  lg: 'max-w-[1056px]',
  xl: 'max-w-[1312px]',
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
    <div className="h-full bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground [&_svg]:size-4">
        {icon}
        <span className="text-xs leading-4 tracking-[0.32px] uppercase">{label}</span>
      </div>
      <p className="mt-2 text-[2.25rem] font-light leading-none tabular-nums text-foreground">
        {value}
      </p>
      {hint ? <p className="mt-2 text-xs leading-4 text-muted-foreground">{hint}</p> : null}
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
  success: 'bg-success/15 text-success',
  primary: 'bg-primary-soft text-primary',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
  neutral: 'bg-layer-accent text-muted-foreground',
} as const;

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const tone = statusTone[status as keyof typeof statusTone] ?? 'neutral';
  const text = label ?? status.replaceAll('_', ' ');
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap px-2 text-xs capitalize leading-4',
        toneStyles[tone],
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
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
    <div className="flex flex-col items-center gap-3 border border-border bg-card px-6 py-12 text-center">
      {icon ? (
        <span className="grid size-12 place-items-center border border-border bg-background text-muted-foreground [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <h3 className="type-h3 text-foreground">{title}</h3>
      {description ? (
        <p className="max-w-md text-sm leading-5 text-muted-foreground">{description}</p>
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
        className="size-4 animate-spin rounded-full border-2 border-muted border-t-primary"
      />
      {label}…
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div aria-hidden className="space-y-3 py-4">
      <div className="h-10 w-[45%] animate-pulse bg-muted" />
      <div className="h-48 animate-pulse bg-muted" />
      <div className="h-28 animate-pulse bg-muted" />
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
    <div role="alert" className="border border-border border-l-[3px] border-l-danger bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description ? (
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
