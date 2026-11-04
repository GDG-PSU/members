'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Card, CardContent, Field, MemberAvatar, Select } from '@gdg/ui';
import { previewUsbKioskAction, type UsbKioskPreview } from '@/app/(admin)/admin/actions';
import { formatDateTime } from '@/lib/format';
import { useUsbLane } from '@/components/admin/use-usb-lane';
import { isAbortError, laneErrorMessage, waitForCard } from '@/components/admin/wait-for-card';

export type KioskSessionOption = {
  id: string;
  label: string;
};

type Message = { kind: 'success' | 'danger'; text: string };

export function UsbKioskPanel({ sessions }: { sessions: KioskSessionOption[] }) {
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? '');
  const [scan, setScan] = useState<UsbKioskPreview | null>(null);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [busy, setBusy] = useState<'read' | 'confirm' | 'reject' | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const {
    connected,
    connecting,
    info,
    status,
    error,
    log,
    connect,
    disconnect,
    sendCommand,
    setError,
    setStatus,
  } = useUsbLane();
  const readAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => readAbortRef.current?.abort();
  }, []);

  async function disconnectLane() {
    readAbortRef.current?.abort();
    await disconnect();
    setScan(null);
    setIdentityChecked(false);
  }

  function cancelRead() {
    readAbortRef.current?.abort();
    setStatus('Card read cancelled.');
  }

  async function readCard() {
    if (busy || readAbortRef.current) return;

    setMessage(null);
    setScan(null);
    setIdentityChecked(false);
    setError('');

    if (!connected) {
      setError('Connect the USB lane before reading a card.');
      return;
    }
    if (!sessionId) {
      setError('Select an event session before reading a card.');
      return;
    }

    const controller = new AbortController();
    readAbortRef.current = controller;
    setBusy('read');
    setStatus('Waiting for card…');

    try {
      const response = await waitForCard(() => sendCommand('nfc.read'), controller.signal);
      const uri = response.result?.uri;
      if (!uri) throw new Error('The card does not contain a readable URL.');

      const preview = await previewUsbKioskAction({ uri, sessionId });
      if (controller.signal.aborted) return;
      if (!preview.ok || !preview.scanId) {
        throw new Error(preview.error ?? 'Could not resolve this card.');
      }

      setScan(preview);
      setStatus('Card read. Confirm identity and attendance.');
    } catch (readError) {
      if (controller.signal.aborted || isAbortError(readError)) return;
      setStatus('');
      setError(laneErrorMessage(readError));
    } finally {
      if (readAbortRef.current === controller) readAbortRef.current = null;
      setBusy(null);
    }
  }

  async function decide(action: 'check_in' | 'check_out' | 'reject') {
    if (!scan?.scanId) return;
    if (action !== 'reject' && scan.photoChangedRecently && !identityChecked) {
      setMessage({ kind: 'danger', text: 'Check the member’s PSU ID before confirming.' });
      return;
    }

    setBusy(action === 'reject' ? 'reject' : 'confirm');
    setMessage(null);
    try {
      const response = await fetch('/api/admin/kiosk/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scanId: scan.scanId,
          action,
          identityCheck: scan.photoChangedRecently ? identityChecked : undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? 'Confirmation failed.');
      }

      setMessage({
        kind: 'success',
        text:
          action === 'reject'
            ? 'Scan dismissed. Nothing was recorded.'
            : action === 'check_out'
              ? `${scan.memberName} checked out.`
              : `${scan.memberName} checked in.`,
      });
      setScan(null);
      setIdentityChecked(false);
      setStatus('Ready for the next card.');
    } catch (confirmError) {
      setMessage({ kind: 'danger', text: laneErrorMessage(confirmError) });
    } finally {
      setBusy(null);
    }
  }

  const action = scan?.action ?? 'check_in';
  const actionLabel = action === 'check_out' ? 'check-out' : 'check-in';

  return (
    <div className="space-y-4">
      <Alert variant="info">
        The card is read locally over USB and the kiosk keeps waiting until one is placed. The URL
        is only a locator; an organizer still confirms the person and the attendance action.
      </Alert>

      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void connect()} disabled={connecting || connected}>
              {connecting ? 'Connecting…' : 'Connect lane'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void disconnectLane()}
              disabled={!connected || connecting}
            >
              Disconnect
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              {connected
                ? (info?.deviceId ?? 'USB connected')
                : connecting
                  ? 'Opening USB serial…'
                  : 'No lane connected'}
            </span>
          </div>

          {error ? (
            <Alert variant="danger" className="mt-4" role="alert">
              {error}
            </Alert>
          ) : null}
          {status ? (
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              {status}
            </p>
          ) : null}
          {connected ? (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Firmware {info?.firmware ?? '—'} · NFC {info?.nfcReady ? 'ready' : 'not ready'} · USB
              serial · 115200
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Field label="Event session" htmlFor="kiosk-session" required>
              <Select
                id="kiosk-session"
                value={sessionId}
                onChange={(event) => {
                  setSessionId(event.target.value);
                  setScan(null);
                  setIdentityChecked(false);
                }}
                disabled={busy !== null || sessions.length === 0}
              >
                {sessions.length === 0 ? (
                  <option value="">No current sessions</option>
                ) : (
                  sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.label}
                    </option>
                  ))
                )}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void readCard()}
                disabled={!connected || !sessionId || busy !== null || sessions.length === 0}
              >
                {busy === 'read' ? 'Waiting…' : 'Read card'}
              </Button>
              {busy === 'read' ? (
                <Button variant="secondary" onClick={cancelRead}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>

          {sessions.length === 0 ? (
            <Alert variant="warning" className="mt-4">
              No event sessions are available. Create or publish an event in{' '}
              <Link href="/admin/events" className="font-semibold underline underline-offset-2">
                Events
              </Link>{' '}
              before opening the kiosk.
            </Alert>
          ) : null}

          {message ? (
            <Alert
              variant={message.kind === 'success' ? 'success' : 'danger'}
              className="mt-4"
              role="status"
            >
              {message.text}
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {scan ? (
        <Card className="overflow-hidden border-l-4 border-l-primary">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <MemberAvatar
                name={scan.memberName ?? 'Member'}
                photoUrl={scan.photoUrl ?? null}
                size={76}
              />
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-extrabold leading-tight tracking-[-0.02em] sm:text-2xl">
                  {scan.memberName}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {scan.memberNumber} · {scan.eventName} · {scan.sessionName}
                </p>
                <p className="mt-1.5 text-sm font-medium">Ready to confirm {actionLabel}.</p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-52">
                <Button
                  size="lg"
                  disabled={busy !== null || Boolean(scan.photoChangedRecently && !identityChecked)}
                  onClick={() => void decide(action)}
                  className="flex-1 sm:w-full"
                >
                  {busy === 'confirm'
                    ? 'Confirming…'
                    : scan.photoChangedRecently && !identityChecked
                      ? 'PSU ID required'
                      : `Confirm ${actionLabel}`}
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  disabled={busy !== null}
                  onClick={() => void decide('reject')}
                  className="shrink-0 text-muted-foreground sm:w-full"
                >
                  {busy === 'reject' ? 'Dismissing…' : 'Dismiss scan'}
                </Button>
              </div>
            </div>

            {scan.photoChangedRecently ? (
              <Alert variant="warning" title="Photo changed in the last 48 hours" className="mt-4">
                <p>
                  Last changed {formatDateTime(scan.photoChangedAt)}. Check their PSU ID before
                  confirming.
                </p>
                <label className="mt-2.5 flex items-start gap-2.5 text-sm font-semibold text-foreground">
                  <input
                    type="checkbox"
                    checked={identityChecked}
                    onChange={(event) => setIdentityChecked(event.target.checked)}
                    className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
                  />
                  I checked this member&apos;s PSU ID
                </label>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed bg-subtle">
          <CardContent className="flex flex-col items-center px-6 py-12 text-center">
            <h2 className="type-h3">Ready for the next card</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Connect the lane, choose the open session, then select <strong>Read card</strong> and
              place a member card on the reader. The kiosk keeps waiting until a card is read;
              select Cancel to stop waiting.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-5">
          <h2 className="type-h3">Device log</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Boot and diagnostic lines from the local serial connection.
          </p>
          <pre className="mt-3 max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[0.7rem] leading-relaxed">
            {log.length > 0 ? log.join('\n') : 'No serial output yet.'}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
