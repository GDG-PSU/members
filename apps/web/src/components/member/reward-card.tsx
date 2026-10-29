'use client';

import { useActionState, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ConfirmDialog } from '@gdg/ui';
import { requestRedemptionAction, type ActionState } from '@/app/(member)/member/actions';

const initial: ActionState = {};

function newKey() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `redeem-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function RewardCard({
  id,
  name,
  description,
  costPoints,
  inventory,
  fulfillmentNote,
  balance,
}: {
  id: string;
  name: string;
  description: string;
  costPoints: number;
  inventory: number | null;
  fulfillmentNote: string;
  balance: number;
}) {
  const [state, action, pending] = useActionState(requestRedemptionAction, initial);
  const [confirm, setConfirm] = useState(false);
  const [idempotencyKey] = useState(newKey);
  const formRef = useRef<HTMLFormElement>(null);

  const soldOut = inventory !== null && inventory <= 0;
  const affordable = balance >= costPoints;
  const disabled = soldOut || !affordable || pending;

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ p: 2.75, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}
        >
          <Typography variant="h5">{name}</Typography>
          <Chip
            label={`${costPoints} pts`}
            color={affordable ? 'primary' : 'default'}
            variant="outlined"
            size="small"
          />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2, flex: 1 }}>
          {description || 'A small thank-you from GDG@PSU.'}
        </Typography>
        {inventory !== null ? (
          <Typography variant="caption" color={soldOut ? 'error.main' : 'text.secondary'}>
            {soldOut ? 'Out of stock' : `${inventory} available`}
          </Typography>
        ) : null}
        {fulfillmentNote ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {fulfillmentNote}
          </Typography>
        ) : null}

        <Box component="form" action={action} ref={formRef} sx={{ mt: 2 }}>
          <input type="hidden" name="rewardId" value={id} />
          <input type="hidden" name="quantity" value="1" />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <Button
            type="button"
            variant="contained"
            fullWidth
            disabled={disabled}
            onClick={() => setConfirm(true)}
          >
            {soldOut
              ? 'Out of stock'
              : !affordable
                ? `Need ${costPoints - balance} more points`
                : pending
                  ? 'Requesting…'
                  : 'Request this'}
          </Button>
          <ConfirmDialog
            open={confirm}
            title={`Request ${name}?`}
            description={
              <span>
                This reserves <strong>{costPoints} points</strong> immediately. An organizer will
                approve and fulfil it. You can cancel before it is fulfilled.
              </span>
            }
            confirmLabel="Reserve points"
            busy={pending}
            onClose={() => setConfirm(false)}
            onConfirm={() => {
              setConfirm(false);
              formRef.current?.requestSubmit();
            }}
          />
        </Box>
        {state.error ? (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {state.error}
          </Alert>
        ) : null}
        {state.ok ? (
          <Alert severity="success" sx={{ mt: 1.5 }}>
            {state.message}
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
