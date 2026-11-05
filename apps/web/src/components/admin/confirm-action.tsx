'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, ConfirmDialog, cn } from '@gdg/ui';

type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'destructive';

function Trigger({
  label,
  variant,
  danger,
  disabled,
  className,
  onOpen,
}: {
  label: string;
  variant: ButtonVariant;
  danger: boolean;
  disabled: boolean;
  className?: string;
  onOpen: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={disabled || pending}
      onClick={onOpen}
      className={cn(danger && 'text-danger hover:bg-danger/10 hover:text-danger', className)}
    >
      {pending ? 'Working…' : label}
    </Button>
  );
}

/**
 * A button for a change that is hard to take back. It asks first, in a dialog
 * that names who or what is affected, and only then runs the server action.
 */
export function ConfirmAction({
  action,
  fields,
  label,
  title,
  description,
  confirmLabel,
  destructive = false,
  variant = 'secondary',
  disabled = false,
  className,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  label: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <form ref={formRef} action={action}>
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Trigger
          label={label}
          variant={variant}
          danger={destructive && variant === 'ghost'}
          disabled={disabled}
          className={className}
          onOpen={() => setOpen(true)}
        />
      </form>
      <ConfirmDialog
        open={open}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        destructive={destructive}
        onClose={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          // Submitting the real form lets React track the action the same way
          // as every other form here, including its redirect.
          formRef.current?.requestSubmit();
        }}
      />
    </>
  );
}
