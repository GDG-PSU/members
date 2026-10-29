'use client';

import { useActionState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { inviteAdministratorAction, type LinkState } from '@/app/(admin)/admin/actions';
import { LinkPanel } from '@/components/admin/link-panel';

const initial: LinkState = {};

/** Invites another administrator by email, returning a link for manual delivery. */
export function AdminInviteForm() {
  const [state, action, pending] = useActionState(inviteAdministratorAction, initial);

  return (
    <Stack spacing={2}>
      <Stack component="form" action={action} spacing={2} noValidate>
        <TextField
          label="Email"
          name="email"
          type="email"
          required
          fullWidth
          autoComplete="off"
          helperText="The invitee must enroll an authenticator before /admin opens."
        />
        <Button type="submit" variant="outlined" disabled={pending} fullWidth>
          {pending ? 'Generating…' : 'Generate admin invite link'}
        </Button>
      </Stack>

      {state.error ? (
        <Alert severity="error" role="alert">
          {state.error}
        </Alert>
      ) : null}
      {state.link ? (
        <LinkPanel link={state.link} email={state.email} title="Admin invite link ready" />
      ) : null}

      <Typography variant="caption" color="text.secondary">
        No email is sent. The invitee sets their password from this one-time link, then enrolls TOTP
        at /admin-mfa. Granting the role is audited.
      </Typography>
    </Stack>
  );
}
