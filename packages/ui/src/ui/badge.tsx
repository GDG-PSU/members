import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export const badgeVariants = cva(
  'inline-flex h-6 items-center gap-1 whitespace-nowrap px-2 text-xs leading-4',
  {
    variants: {
      variant: {
        neutral: 'bg-layer-accent text-foreground',
        outline: 'border border-border-strong bg-transparent text-muted-foreground',
        primary: 'bg-primary-soft text-primary',
        success: 'bg-success/15 text-success',
        warning: 'bg-warning/15 text-warning',
        danger: 'bg-danger/15 text-danger',
        star: 'bg-star/15 text-star',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function Dot({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('size-1.5 rounded-full bg-current opacity-80', className)} />
  );
}
