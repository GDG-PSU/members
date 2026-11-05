'use client';

import { useActionState } from 'react';
import { Alert, Button, Field, Input, Textarea } from '@gdg/ui';
import { createInvitationAction, type LinkState } from '@/app/(admin)/admin/actions';
import { LinkPanel } from '@/components/admin/link-panel';
import { keepValuesOnError } from '@/components/keep-values-on-error';

const initial: LinkState = {};

export function InviteForm() {
  const [state, action, pending] = useActionState(createInvitationAction, initial);

  return (
    <div className="space-y-3">
      <form action={action} onReset={keepValuesOnError(state)} className="space-y-3.5" noValidate>
        <Field label="Email" htmlFor="invite-email">
          <Input id="invite-email" name="email" type="email" required autoComplete="off" />
        </Field>
        <Field label="Member since (paid date)" htmlFor="invite-paid-since" required>
          <Input id="invite-paid-since" name="paidSince" type="date" required />
        </Field>
        <Field label="Internal note" htmlFor="invite-note">
          <Textarea id="invite-note" name="note" rows={2} maxLength={300} className="min-h-20" />
        </Field>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Making the link…' : 'Make an invitation link'}
        </Button>
      </form>

      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
      {state.link ? (
        <LinkPanel
          link={state.link}
          email={state.email}
          title="Invitation link ready"
          hours={state.hours}
        />
      ) : null}

      <p className="text-xs leading-relaxed text-muted-foreground">
        No email is sent, so copy the link and send it yourself. It works for 72 hours. After that
        the invitation shows as not accepted, and New link next to their name makes another.
      </p>
    </div>
  );
}
