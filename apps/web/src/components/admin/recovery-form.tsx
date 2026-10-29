'use client';

import { useActionState, useState } from 'react';
import { Alert, Button } from '@gdg/ui';
import { sendRecoveryAction, type LinkState } from '@/app/(admin)/admin/actions';
import { LinkDialog } from '@/components/admin/link-panel';

const initial: LinkState = {};

export function RecoveryForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(sendRecoveryAction, initial);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const open = Boolean(state.link) && dismissed !== state.link;

  return (
    <div>
      <form action={action}>
        <input type="hidden" name="email" value={email} />
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? 'Generating…' : 'Generate recovery link'}
        </Button>
      </form>
      {state.error ? (
        <Alert variant="danger" className="mt-3" role="alert">
          {state.error}
        </Alert>
      ) : null}
      <p className="mt-2 text-[0.78rem] leading-relaxed text-muted-foreground">
        No email is sent. Copy the link and deliver it privately.
      </p>
      <LinkDialog
        open={open}
        onClose={() => setDismissed(state.link ?? null)}
        link={state.link}
        email={state.email}
        title="Recovery link"
      />
    </div>
  );
}
