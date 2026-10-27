'use client';

import { useActionState, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { sendRecoveryAction, type LinkState } from '@/app/(admin)/admin/actions';
import { LinkDialog } from '@/components/admin/link-panel';

const initial: LinkState = {};

export function RecoveryForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(sendRecoveryAction, initial);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const open = Boolean(state.link) && dismissed !== state.link;

  return (
    <Box>
      <Box component="form" action={action}>
        <input type="hidden" name="email" value={email} />
        <Button type="submit" size="small" variant="outlined" disabled={pending}>
          {pending ? 'Generating…' : 'Generate recovery link'}
        </Button>
      </Box>
      {state.error ? (
        <Alert severity="error" sx={{ mt: 1.5 }} role="alert">
          {state.error}
        </Alert>
      ) : null}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        No email is sent. Copy the link and deliver it privately.
      </Typography>
      <LinkDialog
        open={open}
        onClose={() => setDismissed(state.link ?? null)}
        link={state.link}
        email={state.email}
        title="Recovery link"
      />
    </Box>
  );
}
