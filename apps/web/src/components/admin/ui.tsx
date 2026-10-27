'use client';

import { useFormStatus } from 'react-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';

export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  variant = 'contained',
  color = 'primary',
  size = 'medium',
  fullWidth = false,
  confirmMessage,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: 'contained' | 'outlined' | 'text';
  color?: 'primary' | 'error' | 'inherit' | 'success';
  size?: 'small' | 'medium' | 'large';
  fullWidth?: boolean;
  confirmMessage?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      color={color}
      size={size}
      fullWidth={fullWidth}
      disabled={pending}
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
    <Alert severity={error ? 'error' : 'success'} sx={{ mb: 2 }} role="status">
      {error ?? notice}
    </Alert>
  );
}
