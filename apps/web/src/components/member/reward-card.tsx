'use client';

import { useActionState, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, CardContent, ConfirmDialog } from '@gdg/ui';
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
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await requestRedemptionAction(previous, formData);
      // A key identifies one request. Keeping it after an accepted request would
      // turn the next one into a retry that silently returns the old redemption;
      // keeping it after a failure is what makes a resubmit safe.
      if (result.ok) setIdempotencyKey(newKey());
      return result;
    },
    initial,
  );
  const [confirm, setConfirm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const soldOut = inventory !== null && inventory <= 0;
  const affordable = balance >= costPoints;
  const disabled = soldOut || !affordable || pending;

  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex flex-1 flex-col p-5 pt-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-bold leading-snug">{name}</h3>
          <Badge variant={affordable ? 'primary' : 'neutral'} className="shrink-0 tabular-nums">
            {costPoints} pts
          </Badge>
        </div>

        <p className="mb-3 mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
          {description || 'A small thank-you from GDG@PSU.'}
        </p>

        {inventory !== null ? (
          <p className={`text-xs font-medium ${soldOut ? 'text-danger' : 'text-muted-foreground'}`}>
            {soldOut ? 'Out of stock' : `${inventory} available`}
          </p>
        ) : null}
        {fulfillmentNote ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{fulfillmentNote}</p>
        ) : null}

        <form action={action} ref={formRef} className="mt-4">
          <input type="hidden" name="rewardId" value={id} />
          <input type="hidden" name="quantity" value="1" />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <Button
            type="button"
            className="w-full"
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
                Reserves <strong>{costPoints} points</strong> now. Cancel before an organizer
                fulfils it.
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
        </form>

        {state.error ? (
          <div className="mt-3">
            <Alert variant="danger">{state.error}</Alert>
          </div>
        ) : null}
        {state.ok ? (
          <div className="mt-3">
            <Alert variant="success">{state.message}</Alert>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
