'use client';

import { useActionState } from 'react';
import { Alert, Button, Field, Input } from '@gdg/ui';
import { signInAction, type LoginState } from '@/app/(auth)/login/actions';

const initial: LoginState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, initial);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="Email" htmlFor="login-email">
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          spellCheck={false}
          required
          placeholder="you@psu.edu"
        />
      </Field>
      <Field label="Password" htmlFor="login-password">
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
