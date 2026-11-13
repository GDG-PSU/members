'use client';

import { useState } from 'react';
import { Bluetooth, Usb } from 'lucide-react';
import { Alert, Badge, Button, ConfirmDialog, cn } from '@gdg/ui';
import type { Reader } from '@/components/admin/use-reader';
import { isSecureReader } from '@/lib/reader/protocol';

/**
 * The reader's status and the buttons that connect it, shared by Cards and the
 * kiosk. `line` is what the page wants said while the reader is connected and
 * steady; while it is connecting or moving between links, the reader says so.
 */
export function ReaderConnection({
  reader,
  line,
  busy = false,
}: {
  reader: Reader;
  line: string;
  /** A card is being written, so the link must not be changed under it. */
  busy?: boolean;
}) {
  const { connected, connecting, switching, transport, info } = reader;
  const text =
    connecting || switching
      ? reader.status || 'Connecting to the reader…'
      : connected
        ? line
        : 'Reader not connected';
  const offersBluetooth =
    reader.bluetoothSupported && isSecureReader(info) && info?.bluetooth?.enabled !== false;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="flex items-center gap-2 text-sm" role="status">
        <span
          aria-hidden
          className={cn(
            'size-2.5 rounded-full',
            connecting || switching
              ? 'bg-warning'
              : connected
                ? 'bg-success'
                : 'bg-muted-foreground',
          )}
        />
        {text}
      </p>
      {connected && transport ? (
        <Badge
          variant="outline"
          aria-label={`Connected by ${transport === 'usb' ? 'USB' : 'Bluetooth'}`}
        >
          {transport === 'usb' ? (
            <Usb className="size-3" aria-hidden />
          ) : (
            <Bluetooth className="size-3" aria-hidden />
          )}
          {transport === 'usb' ? 'USB' : 'Bluetooth'}
        </Badge>
      ) : null}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {connected ? (
          <>
            {transport === 'bluetooth' && reader.serialSupported ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void reader.switchToUsb()}
                disabled={busy || switching}
              >
                Switch to USB
              </Button>
            ) : null}
            {transport === 'usb' && offersBluetooth ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void reader.connectBluetooth()}
                disabled={busy || switching}
              >
                Switch to Bluetooth
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => void reader.disconnect()} disabled={busy}>
              Disconnect
            </Button>
          </>
        ) : (
          <>
            {reader.bluetoothSupported ? (
              <Button
                variant="secondary"
                onClick={() => void reader.connectBluetooth()}
                disabled={connecting}
              >
                Use Bluetooth
              </Button>
            ) : null}
            <Button onClick={() => void reader.connect()} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect reader'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function ReaderError({ reader }: { reader: Reader }) {
  return reader.error ? (
    <Alert variant="danger" role="alert">
      {reader.error}
    </Alert>
  ) : null;
}

function bluetoothLine(reader: Reader): string {
  const { info, transport } = reader;
  if (!isSecureReader(info)) {
    return 'This reader’s firmware is older than 2.2.0. It works over the cable only and anyone holding it can use it. Flash it to update it.';
  }
  const bluetooth = info?.bluetooth;
  if (bluetooth?.enabled === false) return 'Bluetooth is switched off on this reader.';
  if (transport === 'bluetooth') return 'In use over Bluetooth. Plug it in to move to the cable.';
  return `Bluetooth is ready. With no computer on its cable it appears as ${bluetooth?.name ?? 'GDG Reader'}.`;
}

/**
 * What the reader is, how it is connected, and what it has said. With `tools`
 * it also offers what changes the reader itself.
 */
export function ReaderDetails({
  reader,
  busy = false,
  tools = false,
}: {
  reader: Reader;
  busy?: boolean;
  tools?: boolean;
}) {
  const { connected, info, transport, log } = reader;
  const allowed = info?.bluetooth?.enabled !== false;
  const [asking, setAsking] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotated, setRotated] = useState<{ ok: boolean; message: string } | null>(null);

  async function rotate() {
    setRotating(true);
    setRotated(null);
    const result = await reader.rotateKey();
    setRotating(false);
    setAsking(false);
    setRotated(result);
  }

  return (
    <>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {connected
          ? `${info?.deviceId ?? 'Reader'} · firmware ${info?.firmware ?? '—'} · NFC ${
              info?.nfcReady ? 'ready' : 'not ready'
            }`
          : 'Plug the reader into this computer, then select Connect reader. With no cable, give the reader power, wait for its light to blink slowly, and select Use Bluetooth. Use Chrome or Edge.'}
      </p>
      {connected ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="text-xs leading-relaxed text-muted-foreground">{bluetoothLine(reader)}</p>
          {transport === 'usb' && isSecureReader(info) ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void reader.setBluetoothAllowed(!allowed)}
              disabled={busy}
            >
              {allowed ? 'Switch Bluetooth off on this reader' : 'Switch Bluetooth on'}
            </Button>
          ) : null}
          {tools && isSecureReader(info) ? (
            <Button variant="ghost" size="sm" onClick={() => setAsking(true)} disabled={busy}>
              Rotate key
            </Button>
          ) : null}
        </div>
      ) : null}
      {rotated ? (
        <Alert variant={rotated.ok ? 'success' : 'danger'} role="status" className="mt-2">
          {rotated.message}
        </Alert>
      ) : null}
      <ConfirmDialog
        open={asking}
        title={`Give ${info?.bluetooth?.name ?? 'this reader'} a new key?`}
        description="The reader keeps working here and for every organizer. Anything that held its old key, such as a copy taken from a lost reader, can no longer use it."
        confirmLabel="Rotate key"
        busy={rotating}
        onConfirm={() => void rotate()}
        onClose={() => setAsking(false)}
      />
      <pre className="mt-3 max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[0.7rem] leading-relaxed">
        {log.length > 0 ? log.join('\n') : 'No messages from the reader yet.'}
      </pre>
    </>
  );
}
