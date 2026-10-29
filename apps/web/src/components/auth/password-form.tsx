'use client';

import { useActionState } from 'react';
import { Alert, Button, Field, Input } from '@gdg/ui';
import { updatePasswordAction, type PasswordState } from '@/app/(auth)/account/password/actions';

const initial: PasswordState = {};

export function PasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(updatePasswordAction, initial);

  return (
    <form action={action} className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Signed in as <span className="font-semibold text-foreground">{email}</span>. Choose a new
        password with at least 12 characters.
      </p>
      <Field label="New password" htmlFor="new-password">
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm-new-password">
        <Input
          id="confirm-new-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
      </Field>
      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}
