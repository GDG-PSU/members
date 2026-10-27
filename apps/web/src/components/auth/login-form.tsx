'use client';

import { useActionState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { signInAction, type LoginState } from '@/app/(auth)/login/actions';

const initial: LoginState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, initial);
  return (
    <Stack component="form" action={action} spacing={2} noValidate>
      <TextField label="Email" name="email" type="email" autoComplete="email" required fullWidth />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        fullWidth
      />
      {state.error ? <Alert severity="error">{state.error}</Alert> : null}
      <Button type="submit" variant="contained" size="large" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </Stack>
  );
}
