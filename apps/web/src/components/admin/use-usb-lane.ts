'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type UsbDeviceInfo = {
  protocol?: number;
  firmware?: string;
  deviceId?: string;
  chipId?: string;
  nfcReady?: boolean;
  nfcFirmware?: number;
  uptimeMs?: number;
};

export type UsbDeviceResult = UsbDeviceInfo & {
  uri?: string;
  uriLength?: number;
  readBack?: boolean;
};

export type UsbApiResponse = {
  id?: number;
  ok: boolean;
  error?: string;
  result?: UsbDeviceResult;
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
  resolve: (response: UsbApiResponse) => void;
  reject: (error: Error) => void;
  timer: number;
};

function getSerial(): SerialLike | null {
  return (navigator as Navigator & { serial?: SerialLike }).serial ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useUsbLane() {
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [info, setInfo] = useState<UsbDeviceInfo | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [log, setLog] = useState<string[]>([]);

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const pendingRef = useRef(new Map<number, Pending>());
  const nextIdRef = useRef(0);
  const closingRef = useRef(false);
  const readFailureRef = useRef<string | null>(null);

  const appendLog = useCallback((line: string) => {
    setLog((previous) => [...previous.slice(-49), line]);
  }, []);

  const handleLine = useCallback(
    (line: string) => {
      if (!line.startsWith('{')) {
        // Boot/status lines are useful when diagnosing a reset or a dead port.
        console.debug('[usb-serial]', line);
        appendLog(line);
        return;
      }

      let message: UsbApiResponse;
      try {
        message = JSON.parse(line) as UsbApiResponse;
      } catch {
        appendLog(line);
        return;
      }

      // Only the outcome: a late nfc.read reply contains the card URL, which must
      // not be written to the on-screen log.
      if (typeof message.id !== 'number') {
        appendLog(`[usb] unmatched reply ok=${message.ok} ${message.error ?? ''}`.trim());
        return;
      }

      const pending = pendingRef.current.get(message.id);
      if (!pending) {
        appendLog(
          `[usb] late reply id=${message.id} ok=${message.ok} ${message.error ?? ''}`.trim(),
        );
        return;
      }

      pendingRef.current.delete(message.id);
      window.clearTimeout(pending.timer);
      if (message.ok) {
        pending.resolve(message);
      } else {
        pending.reject(new Error(message.error ?? 'Device error'));
      }
    },
    [appendLog],
  );

  const readLoop = useCallback(
    async (port: SerialPortLike) => {
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
          // The firmware's own line limit is 1 KB; anything longer is line noise.
          if (buffer.length > 16_384) buffer = '';

          let newline = buffer.indexOf('\n');
          while (newline >= 0) {
            const line = buffer.slice(0, newline).replace(/\r$/, '').trim();
            buffer = buffer.slice(newline + 1);
            if (line) handleLine(line);
            newline = buffer.indexOf('\n');
          }
        }
      } catch (readError) {
        if (!closingRef.current) {
          readFailureRef.current = errorMessage(readError);
          console.error('[usb-serial] read loop failed', readError);
          setError(readFailureRef.current);
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // The reader may already be released by closePort().
        }
        if (readerRef.current === reader) readerRef.current = null;
        if (!closingRef.current) setConnected(false);
      }
    },
    [handleLine],
  );

  const sendCommand = useCallback(
    async (
      cmd: string,
      extra: Record<string, unknown> = {},
      timeoutMs = 6000,
    ): Promise<UsbApiResponse> => {
      const writer = writerRef.current;
      if (!writer) throw new Error('Connect a lane first.');

      const id = ++nextIdRef.current;
      const payload = JSON.stringify({ id, cmd, ...extra }) + '\n';
      const response = new Promise<UsbApiResponse>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingRef.current.delete(id);
          reject(new Error('The device did not answer in time.'));
        }, timeoutMs);
        pendingRef.current.set(id, { resolve, reject, timer });
      });

      await writer.write(new TextEncoder().encode(payload));
      return response;
    },
    [],
  );

  const closePort = useCallback(async (updateState = true) => {
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

    if (updateState) setConnected(false);
  }, []);

  useEffect(() => {
    return () => {
      // A client-side tab change unmounts this panel. Close the port here so
      // the next mount does not inherit an already-open SerialPort.
      void closePort(false);
    };
  }, [closePort]);

  const connect = useCallback(async () => {
    const serial = getSerial();
    if (!serial) {
      setError('Web Serial is unavailable. Use Chrome or Edge over HTTPS or localhost.');
      return;
    }

    setConnecting(true);
    setError('');
    setStatus('');
    setInfo(null);
    setLog([]);
    closingRef.current = false;
    readFailureRef.current = null;

    try {
      const port = await serial.requestPort();
      if (closingRef.current) return;

      setStatus('Opening serial port…');
      await port.open({ baudRate: 115200 });
      portRef.current = port;
      if (closingRef.current) {
        await closePort(false);
        return;
      }

      // Opening a CP210x toggles the ESP32 reset lines. Give the firmware time
      // to boot and initialize the PN532 before the first JSON command.
      setStatus('Waiting for the lane to boot…');
      await sleep(2200);
      if (closingRef.current) return;

      const writer = port.writable?.getWriter();
      if (!writer) throw new Error('The serial port is not writable.');

      writerRef.current = writer;
      setConnected(true);
      void readLoop(port);

      let response: UsbApiResponse | null = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          response = await sendCommand('info', {}, 8000);
          break;
        } catch (handshakeError) {
          lastError = handshakeError;
          if (attempt < 2) {
            setStatus(`Lane is still booting; retrying (${attempt + 2}/3)…`);
            await sleep(1000);
          }
        }
      }

      if (!response) {
        throw new Error(
          readFailureRef.current ??
            errorMessage(lastError ?? new Error('The device did not answer in time.')),
        );
      }

      setInfo(response.result ?? null);
      setStatus('Connected.');
    } catch (connectError) {
      const wasClosing = closingRef.current;
      await closePort();
      if (!wasClosing) setError(errorMessage(connectError));
    } finally {
      setConnecting(false);
    }
  }, [closePort, readLoop, sendCommand]);

  const disconnect = useCallback(async () => {
    await closePort();
    setInfo(null);
    setStatus('Disconnected.');
  }, [closePort]);

  const refresh = useCallback(async () => {
    const response = await sendCommand('info');
    setInfo(response.result ?? null);
  }, [sendCommand]);

  return {
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
  };
}
