'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Check } from 'lucide-react';
import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '../lib/cn';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-xs leading-4 tracking-[0.32px] text-muted-foreground', className)}
      {...props}
    />
  );
}

const control =
  'w-full appearance-none border-b border-solid border-input bg-background px-4 text-sm leading-5 text-foreground transition-colors placeholder:text-[color:var(--text-placeholder)] focus-visible:border-b-transparent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-b-danger';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, 'h-10', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(control, 'min-h-28 resize-y py-3 leading-5', className)} {...props} />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(control, 'h-10 pr-10', className)} {...props}>
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-foreground"
        fill="currentColor"
      >
        <path d="M8 11 3 6h10z" />
      </svg>
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const messageId = htmlFor ? `${htmlFor}-message` : undefined;
  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p id={messageId} className="text-xs leading-4 text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs leading-4 text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Checkbox({
  className,
  checked,
  onCheckedChange,
  disabled,
  id,
  'aria-label': ariaLabel,
}: {
  className?: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  return (
    <CheckboxPrimitive.Root
      id={id}
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      className={cn(
        'grid size-4 shrink-0 place-items-center border border-input bg-background transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground disabled:opacity-50',
        className,
      )}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  id,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  return (
    <SwitchPrimitive.Root
      id={id}
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      className={cn(
        'relative inline-flex h-6 w-12 shrink-0 cursor-pointer items-center border-0 bg-input transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary',
      )}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 translate-x-1 bg-white transition-transform data-[state=checked]:translate-x-[1.6rem]" />
    </SwitchPrimitive.Root>
  );
}
