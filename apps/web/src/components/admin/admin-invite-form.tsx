'use client';

import { useActionState } from 'react';
import { Alert, Button, Field, Input } from '@gdg/ui';
import { inviteAdministratorAction, type LinkState } from '@/app/(admin)/admin/actions';
import { LinkPanel } from '@/components/admin/link-panel';

const initial: LinkState = {};

/** Invites another administrator by email, returning a link for manual delivery. */
export function AdminInviteForm() {
  const [state, action, pending] = useActionState(inviteAdministratorAction, initial);

  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3.5" noValidate>
        <Field
          label="Email"
          htmlFor="admin-invite-email"
          hint="The invitee must enroll an authenticator before /admin opens."
        >
          <Input
            id="admin-invite-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            aria-describedby="admin-invite-email-message"
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={pending} className="w-full">
          {pending ? 'Generating…' : 'Generate admin invite link'}
        </Button>
      </form>

      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
      {state.link ? (
        <LinkPanel link={state.link} email={state.email} title="Admin invite link ready" />
      ) : null}

      <p className="text-xs leading-relaxed text-muted-foreground">
        No email is sent. The invitee sets their password from this one-time link, then enrolls TOTP
        at /admin-mfa. Granting the role is audited.
      </p>
    </div>
  );
}
