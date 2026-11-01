import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react';
import { cn } from '../lib/cn';

const alertVariants = cva(
  'flex items-start gap-3 border border-border border-l-[3px] bg-card px-4 py-3 text-sm text-foreground',
  {
    variants: {
      variant: {
        info: 'border-l-primary [&_svg]:text-primary',
        success: 'border-l-success [&_svg]:text-success',
        warning: 'border-l-warning [&_svg]:text-warning',
        danger: 'border-l-danger [&_svg]:text-danger',
        neutral: 'border-l-border-strong [&_svg]:text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'info' },
  },
);

const icons: Record<string, ReactNode> = {
  info: <Info className="mt-0.5 size-5 shrink-0" aria-hidden />,
  success: <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />,
  warning: <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />,
  danger: <OctagonAlert className="mt-0.5 size-5 shrink-0" aria-hidden />,
  neutral: <Info className="mt-0.5 size-5 shrink-0" aria-hidden />,
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
      <div className="min-w-0 space-y-1">
        {title ? <p className="text-sm font-semibold leading-5">{title}</p> : null}
        {children ? (
          <div className="text-sm leading-5 text-muted-foreground">{children}</div>
        ) : null}
      </div>
    </div>
  );
}
