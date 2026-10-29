'use client';

import { useFormStatus } from 'react-dom';
import { Alert, Button, cn } from '@gdg/ui';

type LegacyVariant = 'contained' | 'outlined' | 'text';
type LegacyColor = 'primary' | 'error' | 'inherit' | 'success';
type LegacySize = 'small' | 'medium' | 'large';

const variantMap = {
  contained: 'default',
  outlined: 'secondary',
  text: 'ghost',
} as const;

const sizeMap = {
  small: 'sm',
  medium: 'default',
  large: 'lg',
} as const;

export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  variant = 'contained',
  color = 'primary',
  size = 'medium',
  fullWidth = false,
  confirmMessage,
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: LegacyVariant;
  color?: LegacyColor;
  size?: LegacySize;
  fullWidth?: boolean;
  confirmMessage?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const textDanger = variant === 'text' && color === 'error';
  return (
    <Button
      type="submit"
      variant={textDanger ? 'ghost' : color === 'error' ? 'destructive' : variantMap[variant]}
      size={sizeMap[size]}
      disabled={pending}
      className={cn(
        fullWidth && 'w-full',
        textDanger && 'text-danger hover:bg-danger/10 hover:text-danger',
        className,
      )}
      onClick={
        confirmMessage
          ? (event) => {
              if (!window.confirm(confirmMessage)) event.preventDefault();
            }
          : undefined
      }
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}

export function Flash({ notice, error }: { notice?: string; error?: string }) {
  if (!notice && !error) return null;
  return (
    <Alert variant={error ? 'danger' : 'success'} className="mb-4" role="status">
      {error ?? notice}
    </Alert>
  );
}
