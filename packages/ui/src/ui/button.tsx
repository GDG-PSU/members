import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

const buttonStyles = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[background-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-[0_1px_2px_rgb(10_16_32/0.18)] hover:bg-primary/90',
        secondary: 'border border-border bg-card text-foreground hover:bg-muted',
        soft: 'bg-primary-soft text-primary hover:bg-primary-soft/70',
        outline: 'border border-border bg-transparent text-foreground hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted',
        destructive: 'bg-danger text-white shadow-sm hover:bg-danger/90',
        inverse: 'bg-white text-[#0b1730] shadow-sm hover:bg-white/90',
        link: 'rounded-none p-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-4 text-[0.82rem]',
        default: 'h-11 px-5 text-sm',
        lg: 'h-12 px-6 text-[0.95rem]',
        icon: 'size-10 rounded-xl p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonVariantProps = Parameters<typeof buttonStyles>[0];

/**
 * cva concatenates className overrides instead of merging them, so custom token
 * utilities such as `text-[#0b1730]` could lose to the variant's text color.
 * Passing the result through cn() makes every caller's override deterministic.
 */
export function buttonVariants(props?: ButtonVariantProps) {
  return cn(buttonStyles(props));
}

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
