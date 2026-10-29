'use client';

import { useActionState } from 'react';
import { Alert, Field, Input } from '@gdg/ui';
import { enrollMfaAction, verifyMfaAction, type MfaState } from '@/app/admin-mfa/actions';
import { SubmitButton } from '@/components/admin/ui';

const initial: MfaState = {};

function CodeField({ autoFocus = false }: { autoFocus?: boolean }) {
  return (
    <Field label="Six-digit code" htmlFor="mfa-code" hint="Codes rotate every 30 seconds.">
      <Input
        id="mfa-code"
        name="code"
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        autoComplete="one-time-code"
        required
        autoFocus={autoFocus}
        className="font-mono text-lg tracking-[0.3em]"
      />
    </Field>
  );
}

export function MfaPanel({
  hasVerifiedFactor,
  email,
  verifiedFactorId,
}: {
  hasVerifiedFactor: boolean;
  email: string;
  verifiedFactorId?: string;
}) {
  const [enrollState, enrollAction] = useActionState(enrollMfaAction, initial);
  const [verifyState, verifyAction] = useActionState(verifyMfaAction, initial);
  const factorId = enrollState.factorId ?? verifyState.factorId ?? verifiedFactorId ?? '';

  if (hasVerifiedFactor) {
    return (
      <form action={verifyAction} className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Signed in as <span className="font-semibold text-foreground">{email}</span>. Enter the
          current code from your authenticator app.
        </p>
        <input type="hidden" name="factorId" value={factorId} />
        <CodeField autoFocus />
        {verifyState.error ? <Alert variant="danger">{verifyState.error}</Alert> : null}
        <SubmitButton pendingLabel="Verifying…" fullWidth>
          Verify and open admin
        </SubmitButton>
      </form>
    );
  }

  if (enrollState.qrCode) {
    return (
      <form action={verifyAction} className="space-y-4">
        <Alert variant="info">
          Scan the QR code with your authenticator app, then enter the six-digit code below.
        </Alert>
        {/* eslint-disable-next-line @next/next/no-img-element -- data-URL QR from Supabase, not an optimizable remote image */}
        <img
          src={enrollState.qrCode}
          alt="TOTP enrollment QR code"
          width={220}
          height={220}
          className="mx-auto size-[220px] rounded-2xl border border-border bg-white p-2"
        />
        {enrollState.secret ? (
          <p className="text-center text-[0.78rem] text-muted-foreground">
            Manual key:{' '}
            <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.75rem] text-foreground">
              {enrollState.secret}
            </code>
          </p>
        ) : null}
        <input type="hidden" name="factorId" value={enrollState.factorId ?? ''} />
        <CodeField autoFocus />
        {verifyState.error ? <Alert variant="danger">{verifyState.error}</Alert> : null}
        <SubmitButton pendingLabel="Verifying…" fullWidth>
          Verify and open admin
        </SubmitButton>
      </form>
    );
  }

  return (
    <form action={enrollAction} className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        No authenticator is enrolled for{' '}
        <span className="font-semibold text-foreground">{email}</span>. Enroll one now — you will
        need it for every admin session.
      </p>
      {enrollState.error ? <Alert variant="danger">{enrollState.error}</Alert> : null}
      <SubmitButton pendingLabel="Starting…" fullWidth className="h-11">
        Set up authenticator
      </SubmitButton>
    </form>
  );
}
