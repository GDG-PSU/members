'use client';

import { useActionState } from 'react';
import { Alert, Button, Field, Input, Select } from '@gdg/ui';
import { inviteAdministratorAction, type LinkState } from '@/app/(admin)/admin/actions';
import { LinkPanel } from '@/components/admin/link-panel';

const initial: LinkState = {};

/** Invites another staff member by email, returning a link for manual delivery. */
export function AdminInviteForm() {
  const [state, action, pending] = useActionState(inviteAdministratorAction, initial);

  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3.5" noValidate>
        <Field label="Email" htmlFor="admin-invite-email" hint="TOTP required before /admin opens.">
          <Input
            id="admin-invite-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            aria-describedby="admin-invite-email-message"
          />
        </Field>
        <Field label="Role" htmlFor="admin-invite-role">
          <Select id="admin-invite-role" name="role" defaultValue="admin">
            <option value="admin">Admin</option>
            <option value="superadmin">Superadmin</option>
          </Select>
        </Field>
        <Button type="submit" variant="secondary" disabled={pending} className="w-full">
          {pending ? 'Generating…' : 'Generate staff invite link'}
        </Button>
      </form>

      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
      {state.link ? (
        <LinkPanel
          link={state.link}
          email={state.email}
          title={
            state.role === 'superadmin' ? 'Superadmin invite link ready' : 'Admin invite link ready'
          }
        />
      ) : null}

      <p className="text-xs leading-relaxed text-muted-foreground">
        No email is sent. The invitee sets a password, then enrolls TOTP. Superadmins can manage
        users and view the full audit log.
      </p>
    </div>
  );
}
