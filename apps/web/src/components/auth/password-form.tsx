'use client';

import { useActionState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { updatePasswordAction, type PasswordState } from '@/app/(auth)/account/password/actions';

const initial: PasswordState = {};

export function PasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(updatePasswordAction, initial);

  return (
    <Stack component="form" action={action} spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Signed in as {email}. Choose a new password with at least 12 characters.
      </Typography>
      <TextField
        name="password"
        type="password"
        label="New password"
        autoComplete="new-password"
        required
        fullWidth
        slotProps={{ htmlInput: { minLength: 12, maxLength: 128 } }}
      />
      <TextField
        name="confirmPassword"
        type="password"
        label="Confirm new password"
        autoComplete="new-password"
        required
        fullWidth
        slotProps={{ htmlInput: { minLength: 12, maxLength: 128 } }}
      />
      {state.error ? <Alert severity="error">{state.error}</Alert> : null}
      <Button type="submit" variant="contained" disabled={pending} sx={{ alignSelf: 'flex-start' }}>
        {pending ? 'Saving…' : 'Set new password'}
      </Button>
    </Stack>
  );
}
