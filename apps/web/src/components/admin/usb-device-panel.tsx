'use client';

import { useState } from 'react';
import { Alert, Button, Card, CardContent, Field, Input } from '@gdg/ui';
import { useUsbLane } from '@/components/admin/use-usb-lane';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function UsbDevicePanel() {
  const [cardUri, setCardUri] = useState<string | null>(null);
  const [writeUri, setWriteUri] = useState('');
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

  async function disconnectLane() {
    await disconnect();
    setCardUri(null);
  }

  async function refreshLane() {
    try {
      await refresh();
    } catch (refreshError) {
      setError(errorMessage(refreshError));
    }
  }

  async function readCard() {
    setError('');
    setStatus('Reading card…');
    try {
      const response = await sendCommand('nfc.read');
      setCardUri(response.result?.uri ?? '');
      setStatus('Card read.');
    } catch (readError) {
      setCardUri(null);
      setStatus('');
      setError(errorMessage(readError));
    }
  }

  async function writeCard() {
    const uri = writeUri.trim();
    if (!uri) {
      setError('Enter a URI to write.');
      return;
    }

    setError('');
    setStatus('Writing card…');
    try {
      await sendCommand('nfc.write', { uri });
      setStatus('Write completed and read back.');
      await refresh().catch(() => {});
    } catch (writeError) {
      setStatus('');
      setError(errorMessage(writeError));
    }
  }

  const nfcFirmware =
    info?.nfcFirmware && info.nfcFirmware > 0
      ? `0x${info.nfcFirmware.toString(16).padStart(8, '0')}`
      : '—';
  const uptime = typeof info?.uptimeMs === 'number' ? `${Math.floor(info.uptimeMs / 1000)} s` : '—';

  return (
    <div className="space-y-4">
      <Alert variant="success" role="status">
        This connects directly to a lane over USB. It does not use the device registry, WiFi, or the
        server. An admin session is still required to open this page.
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
              disabled={!connected || connecting}
            >
              Refresh
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              {connected ? 'USB connected' : 'No lane connected'}
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

          <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
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
              <dd className="mt-0.5">{info?.nfcReady ? `ready (${nfcFirmware})` : 'not ready'}</dd>
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
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h2 className="type-h3">Read a card</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Reads the NTAG URI. A blank or non-NDEF card returns the device error code.
            </p>
            <Button
              className="mt-4"
              onClick={() => void readCard()}
              disabled={!connected || connecting}
            >
              Read card
            </Button>
            {cardUri ? (
              <p className="mt-4 break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
                {cardUri}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h2 className="type-h3">Write a card</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Writes and verifies one NDEF URI. Use a valid member card URL for a production tag.
            </p>
            <Field label="NDEF URI" htmlFor="usb-write-uri" className="mt-4">
              <Input
                id="usb-write-uri"
                value={writeUri}
                onChange={(event) => setWriteUri(event.target.value)}
                placeholder="https://members-bay-eight.vercel.app/c/…"
                disabled={!connected || connecting}
              />
            </Field>
            <Button
              className="mt-3"
              onClick={() => void writeCard()}
              disabled={!connected || connecting}
            >
              Write and verify
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <h2 className="type-h3">Device log</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Raw serial lines are shown here; JSON responses are consumed by the controls above.
          </p>
          <pre className="mt-3 max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[0.7rem] leading-relaxed">
            {log.length > 0 ? log.join('\n') : 'No serial output yet.'}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
