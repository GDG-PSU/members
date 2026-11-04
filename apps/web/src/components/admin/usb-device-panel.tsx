'use client';

import { useRef, useState } from 'react';
import { Alert, Button, Card, CardContent, Field, Input } from '@gdg/ui';

type DeviceInfo = {
  protocol?: number;
  firmware?: string;
  deviceId?: string;
  chipId?: string;
  nfcReady?: boolean;
  nfcFirmware?: number;
  uptimeMs?: number;
};

type DeviceResult = DeviceInfo & {
  uri?: string;
  uriLength?: number;
  readBack?: boolean;
};

type ApiResponse = {
  id?: number;
  ok: boolean;
  error?: string;
  result?: DeviceResult;
};

type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
};

type SerialLike = {
  requestPort(): Promise<SerialPortLike>;
};

type Pending = {
  resolve: (response: ApiResponse) => void;
  reject: (error: Error) => void;
  timer: number;
};

function getSerial(): SerialLike | null {
  return (navigator as Navigator & { serial?: SerialLike }).serial ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function UsbDevicePanel() {
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [cardUri, setCardUri] = useState<string | null>(null);
  const [writeUri, setWriteUri] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [log, setLog] = useState<string[]>([]);

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const pendingRef = useRef(new Map<number, Pending>());
  const nextIdRef = useRef(0);
  const closingRef = useRef(false);

  function appendLog(line: string) {
    setLog((previous) => [...previous.slice(-49), line]);
  }

  function handleLine(line: string) {
    if (!line.startsWith('{')) {
      appendLog(line);
      return;
    }

    let message: ApiResponse;
    try {
      message = JSON.parse(line) as ApiResponse;
    } catch {
      appendLog(line);
      return;
    }

    if (typeof message.id !== 'number') {
      appendLog(line);
      return;
    }

    const pending = pendingRef.current.get(message.id);
    if (!pending) {
      appendLog(line);
      return;
    }

    pendingRef.current.delete(message.id);
    window.clearTimeout(pending.timer);
    if (message.ok) {
      pending.resolve(message);
    } else {
      pending.reject(new Error(message.error ?? 'Device error'));
    }
  }

  async function readLoop(port: SerialPortLike) {
    const reader = port.readable?.getReader();
    if (!reader) {
      setError('The serial port is not readable.');
      return;
    }
    readerRef.current = reader;
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (readerRef.current === reader) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) buffer += decoder.decode(value, { stream: true });

        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '').trim();
          buffer = buffer.slice(newline + 1);
          if (line) handleLine(line);
          newline = buffer.indexOf('\n');
        }
      }
    } catch (readError) {
      if (!closingRef.current) setError(errorMessage(readError));
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // The reader may already be released by disconnect().
      }
      if (readerRef.current === reader) readerRef.current = null;
      if (!closingRef.current) setConnected(false);
    }
  }

  async function sendCommand(
    cmd: string,
    extra: Record<string, unknown> = {},
  ): Promise<ApiResponse> {
    const writer = writerRef.current;
    if (!writer) throw new Error('Connect a lane first.');

    const id = ++nextIdRef.current;
    const payload = JSON.stringify({ id, cmd, ...extra }) + '\n';
    const response = new Promise<ApiResponse>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingRef.current.delete(id);
        reject(new Error('The device did not answer in time.'));
      }, 6000);
      pendingRef.current.set(id, { resolve, reject, timer });
    });

    await writer.write(new TextEncoder().encode(payload));
    return response;
  }

  async function closePort() {
    closingRef.current = true;

    for (const pending of pendingRef.current.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error('Disconnected.'));
    }
    pendingRef.current.clear();

    const reader = readerRef.current;
    readerRef.current = null;
    try {
      await reader?.cancel();
    } catch {
      // Already closed.
    }
    try {
      reader?.releaseLock();
    } catch {
      // Already released.
    }

    const writer = writerRef.current;
    writerRef.current = null;
    try {
      writer?.releaseLock();
    } catch {
      // Already released.
    }

    const port = portRef.current;
    portRef.current = null;
    try {
      await port?.close();
    } catch {
      // Already closed.
    }

    setConnected(false);
  }

  async function connect() {
    const serial = getSerial();
    if (!serial) {
      setError('Web Serial is unavailable. Use Chrome or Edge over HTTPS or localhost.');
      return;
    }

    setConnecting(true);
    setError('');
    setStatus('');
    setCardUri(null);
    setLog([]);
    closingRef.current = false;

    try {
      const port = await serial.requestPort();
      await port.open({ baudRate: 115200 });
      const writer = port.writable?.getWriter();
      if (!writer) throw new Error('The serial port is not writable.');

      portRef.current = port;
      writerRef.current = writer;
      setConnected(true);
      void readLoop(port);

      const response = await sendCommand('info');
      setInfo(response.result ?? null);
      setStatus('Connected.');
    } catch (connectError) {
      await closePort();
      setError(errorMessage(connectError));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    await closePort();
    setInfo(null);
    setCardUri(null);
    setStatus('Disconnected.');
  }

  async function refresh() {
    const response = await sendCommand('info');
    setInfo(response.result ?? null);
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
      await refresh();
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
              onClick={() => void disconnect()}
              disabled={!connected || connecting}
            >
              Disconnect
            </Button>
            <Button
              variant="ghost"
              onClick={() => void refresh()}
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
