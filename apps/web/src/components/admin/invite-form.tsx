'use client';

import { useActionState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { createInvitationAction, type LinkState } from '@/app/(admin)/admin/actions';
import { LinkPanel } from '@/components/admin/link-panel';

const initial: LinkState = {};

export function InviteForm() {
  const [state, action, pending] = useActionState(createInvitationAction, initial);

  return (
    <Stack spacing={2}>
      <Stack component="form" action={action} spacing={2} noValidate>
        <TextField label="Email" name="email" type="email" required fullWidth autoComplete="off" />
        <TextField
          label="Member since (paid date)"
          name="paidSince"
          type="date"
          required
          fullWidth
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          label="Internal note"
          name="note"
          fullWidth
          multiline
          minRows={2}
          slotProps={{ htmlInput: { maxLength: 300 } }}
        />
        <Button type="submit" variant="contained" disabled={pending} fullWidth>
          {pending ? 'Generating…' : 'Generate invitation link'}
        </Button>
      </Stack>

      {state.error ? (
        <Alert severity="error" role="alert">
          {state.error}
        </Alert>
      ) : null}
      {state.link ? (
        <LinkPanel link={state.link} email={state.email} title="Invitation link ready" />
      ) : null}

      <Typography variant="caption" color="text.secondary">
        No email is sent. Copy the link and send it yourself. Duplicate pending invitations are
        blocked; invitations expire after 14 days and can be revoked or reissued.
      </Typography>
    </Stack>
  );
}
