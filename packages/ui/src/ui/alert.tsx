import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react';
import { cn } from '../lib/cn';

const alertVariants = cva('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', {
  variants: {
    variant: {
      info: 'border-primary/20 bg-primary-soft/60 text-foreground [&_svg]:text-primary',
      success: 'border-success/25 bg-success/10 text-foreground [&_svg]:text-success',
      warning: 'border-warning/30 bg-warning/10 text-foreground [&_svg]:text-warning',
      danger: 'border-danger/30 bg-danger/10 text-foreground [&_svg]:text-danger',
      neutral: 'border-border bg-muted text-muted-foreground [&_svg]:text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'info' },
});

const icons: Record<string, ReactNode> = {
  info: <Info className="mt-0.5 size-4 shrink-0" aria-hidden />,
  success: <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />,
  warning: <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />,
  danger: <OctagonAlert className="mt-0.5 size-4 shrink-0" aria-hidden />,
  neutral: <Info className="mt-0.5 size-4 shrink-0" aria-hidden />,
};

export interface AlertProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'>, VariantProps<typeof alertVariants> {
  title?: ReactNode;
  icon?: ReactNode;
}

export function Alert({
  className,
  variant = 'info',
  title,
  icon,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role={variant === 'danger' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {icon ?? icons[variant ?? 'info']}
      <div className="min-w-0 space-y-0.5">
        {title ? <p className="font-semibold leading-snug">{title}</p> : null}
        {children ? (
          <div className="text-[0.86rem] leading-relaxed text-muted-foreground">{children}</div>
        ) : null}
      </div>
    </div>
  );
}
