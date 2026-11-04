'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, Card, CardContent, Field, Input, Select } from '@gdg/ui';
import {
  activateUsbCardAction,
  prepareUsbCardAction,
  type UsbCardState,
} from '@/app/(admin)/admin/actions';

const initialState: UsbCardState = {};

type MemberOption = { id: string; label: string };

export function UsbCardPreparation({ members }: { members: MemberOption[] }) {
  const [prepared, prepare, preparing] = useActionState(prepareUsbCardAction, initialState);
  const [activation, activate, activating] = useActionState(activateUsbCardAction, initialState);
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    if (!prepared.cardUrl) return;
    await navigator.clipboard.writeText(prepared.cardUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <p className="type-overline text-primary">Card preparation</p>
        <h2 className="type-h3 mt-1.5">Prepare a URL for this writer</h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Prepare a pending card, copy its URL into the writer below, write and read it back, then
          activate it. The card stays unavailable at <code>/c/…</code> until activation, and the
          member&apos;s current card keeps working until then.
        </p>

        <form
          action={prepare}
          className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end"
        >
          <Field label="Member" htmlFor="usb-member" required>
            <Select id="usb-member" name="memberId" required defaultValue="">
              <option value="" disabled>
                Select an active member
              </option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason (optional)" htmlFor="usb-reason">
            <Input id="usb-reason" name="reason" maxLength={200} />
          </Field>
          <Button type="submit" disabled={preparing}>
            {preparing ? 'Preparing…' : 'Prepare card'}
          </Button>
        </form>

        {prepared.error ? (
          <Alert variant="danger" className="mt-4">
            {prepared.error}
          </Alert>
        ) : null}

        {prepared.cardUrl ? (
          <div className="mt-5 rounded-xl border border-outline-variant bg-surface-container-low p-4">
            <p className="text-sm font-semibold">
              {prepared.memberLabel ? `Pending card for ${prepared.memberLabel}` : 'Pending card'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                aria-label="Card URL"
                readOnly
                value={prepared.cardUrl}
                className="min-w-0 flex-1 font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button type="button" variant="outline" onClick={copyUrl}>
                {copied ? 'Copied' : 'Copy URL'}
              </Button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Write this exact URL to the tag with the USB panel. Activate only after the writer
              reports a matching read-back.
            </p>
            <form action={activate} className="mt-3">
              <input type="hidden" name="cardId" value={prepared.cardId ?? ''} />
              <label className="mb-3 flex items-start gap-2 text-sm leading-relaxed">
                <input type="checkbox" name="readBackVerified" required className="mt-1" />
                <span>I verified the URL was written and the read-back matches.</span>
              </label>
              <Button type="submit" disabled={activating || activation.activated}>
                {activation.activated
                  ? 'Card activated'
                  : activating
                    ? 'Activating…'
                    : 'Activate written card'}
              </Button>
            </form>
            {activation.error ? (
              <Alert variant="danger" className="mt-3">
                {activation.error}
              </Alert>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
