'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, CardContent, Field, Input } from '@gdg/ui';
import { useUsbLane } from '@/components/admin/use-usb-lane';
import { isAbortError, waitForCard } from '@/components/admin/wait-for-card';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function UsbDevicePanel() {
  const [cardUri, setCardUri] = useState<string | null>(null);
  const [writeUri, setWriteUri] = useState('');
  const [busy, setBusy] = useState<'read' | 'write' | null>(null);
  const waitAbortRef = useRef<AbortController | null>(null);
  const {
    connected,
    connecting,
    info,
    status,
    error,
    log,
    connect,
    disconnect,
    refresh,
    sendCommand,
    setError,
    setStatus,
  } = useUsbLane();

  useEffect(() => {
    return () => waitAbortRef.current?.abort();
  }, []);

  async function disconnectLane() {
    waitAbortRef.current?.abort();
    await disconnect();
    setCardUri(null);
  }

  function cancelWait() {
    waitAbortRef.current?.abort();
    setStatus('Waiting cancelled.');
  }

  async function refreshLane() {
    try {
      await refresh();
    } catch (refreshError) {
      setError(errorMessage(refreshError));
    }
  }

  async function readCard() {
    if (busy || waitAbortRef.current) return;

    setError('');
    setCardUri(null);
    const controller = new AbortController();
    waitAbortRef.current = controller;
    setBusy('read');
    setStatus('Waiting for card…');

    try {
      const response = await waitForCard(() => sendCommand('nfc.read'), controller.signal);
      setCardUri(response.result?.uri ?? '');
      setStatus('Card read.');
    } catch (readError) {
      if (controller.signal.aborted || isAbortError(readError)) return;
      setCardUri(null);
      setStatus('');
      setError(errorMessage(readError));
    } finally {
      if (waitAbortRef.current === controller) waitAbortRef.current = null;
      setBusy(null);
    }
  }

  async function writeCard() {
    if (busy || waitAbortRef.current) return;

    const uri = writeUri.trim();
    if (!uri) {
      setError('Enter a URI to write.');
      return;
    }

    setError('');
    const controller = new AbortController();
    waitAbortRef.current = controller;
    setBusy('write');
    setStatus('Waiting for card…');

    try {
      await waitForCard(() => sendCommand('nfc.write', { uri }), controller.signal);
      setStatus('Write completed and read back.');
      await refresh().catch(() => {});
    } catch (writeError) {
      if (controller.signal.aborted || isAbortError(writeError)) return;
      setStatus('');
      setError(errorMessage(writeError));
    } finally {
      if (waitAbortRef.current === controller) waitAbortRef.current = null;
      setBusy(null);
    }
  }

  const nfcFirmware =
    info?.nfcFirmware && info.nfcFirmware > 0
      ? `0x${info.nfcFirmware.toString(16).padStart(8, '0')}`
      : '—';
  const uptime = typeof info?.uptimeMs === 'number' ? `${Math.floor(info.uptimeMs / 1000)} s` : '—';

  return (
    <div className="space-y-4">
      <Alert variant={connected ? 'success' : connecting ? 'info' : 'neutral'} role="status">
        {connected
          ? `USB lane connected${info?.deviceId ? ` · ${info.deviceId}` : ''}.`
          : connecting
            ? 'Connecting to USB lane…'
            : 'USB lane disconnected. Connect a lane to read or write a card.'}
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
            <Button
              variant="ghost"
              onClick={() => void refreshLane()}
              disabled={!connected || connecting || busy !== null}
            >
              Refresh
            </Button>
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

          <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            {connected
              ? `Firmware ${info?.firmware ?? '—'} · ${
                  info?.nfcReady ? `NFC ready (${nfcFirmware})` : 'NFC not ready'
                }`
              : 'Connect a lane to read or write a card.'}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h3 className="type-h3">Read a card</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Reads the NTAG URI. When the reader is empty, it keeps waiting until a card is placed;
              select Cancel to stop.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                onClick={() => void readCard()}
                disabled={!connected || connecting || busy !== null}
              >
                {busy === 'read' ? 'Waiting…' : 'Read card'}
              </Button>
              {busy === 'read' ? (
                <Button variant="secondary" onClick={cancelWait}>
                  Cancel
                </Button>
              ) : null}
            </div>
            {cardUri ? (
              <p className="mt-4 break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
                {cardUri}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h3 className="type-h3">Write a card</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Writes and verifies one NDEF URI. If the reader is empty, it waits for a card before
              writing; select Cancel to stop waiting. Use a valid member card URL for a production
              tag.
            </p>
            <Field label="NDEF URI" htmlFor="usb-write-uri" className="mt-4">
              <Input
                id="usb-write-uri"
                value={writeUri}
                onChange={(event) => setWriteUri(event.target.value)}
                placeholder="https://members-bay-eight.vercel.app/c/…"
                disabled={!connected || connecting || busy !== null}
              />
            </Field>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                onClick={() => void writeCard()}
                disabled={!connected || connecting || busy !== null}
              >
                {busy === 'write' ? 'Waiting…' : 'Write and verify'}
              </Button>
              {busy === 'write' ? (
                <Button variant="secondary" onClick={cancelWait}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <details>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
            <span>
              <span className="block text-sm font-semibold">Advanced hardware details</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Device information and raw serial log
              </span>
            </span>
            <span className="text-xs text-muted-foreground">Expand</span>
          </summary>
          <div className="border-t border-border px-5 py-5">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="type-overline text-muted-foreground">Device</dt>
                <dd className="mt-0.5 font-mono text-xs">{info?.deviceId ?? '—'}</dd>
              </div>
              <div>
                <dt className="type-overline text-muted-foreground">Chip</dt>
                <dd className="mt-0.5 font-mono text-xs">{info?.chipId ?? '—'}</dd>
              </div>
              <div>
                <dt className="type-overline text-muted-foreground">Firmware</dt>
                <dd className="mt-0.5">{info?.firmware ?? '—'}</dd>
              </div>
              <div>
                <dt className="type-overline text-muted-foreground">NFC</dt>
                <dd className="mt-0.5">
                  {info?.nfcReady ? `ready (${nfcFirmware})` : 'not ready'}
                </dd>
              </div>
              <div>
                <dt className="type-overline text-muted-foreground">Uptime</dt>
                <dd className="mt-0.5">{uptime}</dd>
              </div>
              <div>
                <dt className="type-overline text-muted-foreground">Transport</dt>
                <dd className="mt-0.5">USB serial · 115200</dd>
              </div>
            </dl>

            <h3 className="type-h3 mt-6">Raw serial log</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Raw serial lines are shown here; JSON responses are consumed by the controls above.
            </p>
            <pre className="mt-3 max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[0.7rem] leading-relaxed">
              {log.length > 0 ? log.join('\n') : 'No serial output yet.'}
            </pre>
          </div>
        </details>
      </Card>
    </div>
  );
}
