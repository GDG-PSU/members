'use client';

import { useActionState, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { regenerateInvitationLinkAction, type LinkState } from '@/app/(admin)/admin/actions';
import { LinkDialog } from '@/components/admin/link-panel';
import { SubmitButton } from '@/components/admin/ui';

const initial: LinkState = {};

export function RegenerateInvitationLink({ invitationId }: { invitationId: string }) {
  const [state, action, pending] = useActionState(regenerateInvitationLinkAction, initial);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const open = Boolean(state.link) && dismissed !== state.link;

  return (
    <Box>
      <Box component="form" action={action}>
        <input type="hidden" name="invitationId" value={invitationId} />
        <SubmitButton size="small" variant="outlined" pendingLabel="Generating…">
          New link
        </SubmitButton>
      </Box>
      {pending ? null : state.error ? (
        <Typography variant="caption" color="error" role="alert">
          {state.error}
        </Typography>
      ) : null}
      <LinkDialog
        open={open}
        onClose={() => setDismissed(state.link ?? null)}
        link={state.link}
        email={state.email}
        title="New invitation link"
      />
    </Box>
  );
}
