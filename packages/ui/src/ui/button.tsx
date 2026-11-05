import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

const buttonStyles = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap border border-transparent text-sm font-normal leading-4 transition-colors duration-150 focus-visible:shadow-[inset_0_0_0_1px_var(--background),inset_0_0_0_2px_var(--ring)] focus-visible:outline-none disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active',
        secondary:
          'border-primary bg-transparent text-primary hover:bg-primary hover:text-primary-foreground active:bg-primary-active',
        soft: 'bg-primary-soft text-primary hover:bg-primary-soft-hover',
        outline:
          'border-primary bg-transparent text-primary hover:bg-primary hover:text-primary-foreground',
        ghost: 'bg-transparent text-primary hover:bg-primary-soft',
        destructive: 'bg-danger text-white hover:bg-danger-hover',
        inverse: 'bg-white text-[#161616] hover:bg-[#e8e8e8]',
        link: 'h-auto border-0 p-0 text-primary underline underline-offset-2 hover:text-primary-hover',
      },
      size: {
        sm: 'h-8 px-3 text-[0.8125rem]',
        default: 'h-10 px-4',
        lg: 'h-12 px-4',
        icon: 'size-10 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonVariantProps = Parameters<typeof buttonStyles>[0];

/**
 * cva concatenates className overrides instead of merging them, so callers'
 * token utilities must pass through cn() to win deterministically.
 */
export function buttonVariants(props?: ButtonVariantProps) {
  return cn(buttonStyles(props));
}

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonStyles> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
