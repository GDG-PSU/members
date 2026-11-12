import {
  LinkClosedError,
  RequestTracker,
  errorMessage,
  parseReaderLine,
  sleep,
  type LinkHooks,
  type ReaderLink,
} from '@/lib/reader/link';
import {
  LineBuffer,
  supportsBluetooth,
  type ReaderInfo,
  type ReaderResponse,
} from '@/lib/reader/protocol';

export type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
};

export type SerialLike = {
  requestPort(): Promise<SerialPortLike>;
  /** Ports this site was already allowed to use, so no picker is needed. */
  getPorts?(): Promise<SerialPortLike[]>;
  addEventListener?(type: 'connect' | 'disconnect', listener: (event: Event) => void): void;
};

// Opening a CP210x resets the ESP32. Firmware from 2.1.0 says when it has
// started again; older firmware needs the whole wait.
const BOOT_WAIT_MS = 2200;
const KEEP_ALIVE_MS = 2000;

/**
 * The reader on its USB cable, through Web Serial.
 *
 * While the link is open and idle it sends a small ping every two seconds. That
 * is how the reader knows a computer is on the cable, as opposed to a charger,
 * and so keeps Bluetooth off.
 */
export class SerialLink implements ReaderLink {
  readonly transport = 'usb' as const;
  info: ReaderInfo | null = null;

  private readonly tracker = new RequestTracker();
  private readonly lines = new LineBuffer();
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private opened = false;
  private closing = false;
  private lost = false;
  private quiet = false;
  private lastSentAt = 0;
  private missedPings = 0;
  private started: (() => void) | null = null;

  private constructor(
    readonly port: SerialPortLike,
    private readonly hooks: LinkHooks,
  ) {}

  static async open(port: SerialPortLike, hooks: LinkHooks): Promise<SerialLink> {
    const link = new SerialLink(port, hooks);
    try {
      await link.start();
    } catch (error) {
      await link.close();
      throw error;
    }
    return link;
  }

  private async start() {
    this.hooks.onStatus('Opening serial port…');
    await this.port.open({ baudRate: 115200 });
    this.opened = true;

    const writer = this.port.writable?.getWriter();
    if (!writer) throw new Error('The serial port is not writable.');
    this.writer = writer;
    void this.readLoop();

    this.hooks.onStatus('Waiting for the reader to start…');
    const startedAgain = new Promise<void>((resolve) => {
      this.started = resolve;
    });
    // A reader that was not reset by the port opening answers this at once. One
    // that was reset never sees it, and says so itself when it is back.
    const early = this.send('info', {}, BOOT_WAIT_MS).catch(() => null);
    let response = await Promise.race([
      early,
      startedAgain.then(() => null),
      sleep(BOOT_WAIT_MS).then(() => null),
    ]);
    this.started = null;

    let lastError: unknown = null;
    for (let attempt = 0; !response && attempt < 3; attempt += 1) {
      try {
        response = await this.send('info', {}, 8000);
      } catch (handshakeError) {
        lastError = handshakeError;
        if (this.lost || this.closing) break;
        if (attempt < 2) {
          this.hooks.onStatus(`The reader is still starting; retrying (${attempt + 2}/3)…`);
          await sleep(1000);
        }
      }
    }
    if (!response) {
      throw new Error(errorMessage(lastError ?? new Error('The device did not answer in time.')));
    }

    this.info = response.result ?? null;
    if (supportsBluetooth(this.info)) {
      this.keepAlive = setInterval(() => this.ping(), KEEP_ALIVE_MS);
    }
  }

  private ping() {
    if (this.quiet || this.closing || this.lost || this.tracker.busy) return;
    if (Date.now() - this.lastSentAt < KEEP_ALIVE_MS - 500) return;
    this.send('ping', {}, 3000).then(
      () => {
        this.missedPings = 0;
      },
      (error: unknown) => {
        if (error instanceof LinkClosedError) return;
        this.missedPings += 1;
        if (this.missedPings >= 2) this.fail('The reader stopped answering over the cable.');
      },
    );
  }

  private async readLoop() {
    const reader = this.port.readable?.getReader();
    if (!reader) {
      this.fail('The serial port is not readable.');
      return;
    }
    this.reader = reader;
    const decoder = new TextDecoder();

    try {
      while (this.reader === reader) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        for (const line of this.lines.push(decoder.decode(value, { stream: true }))) {
          this.handleLine(line);
        }
      }
      if (!this.closing) this.fail('The reader was unplugged.');
    } catch (readError) {
      if (!this.closing) {
        // A cable being pulled is ordinary now; whoever owns the link decides what it means.
        console.debug('[usb-serial] read loop ended', readError);
        this.fail(errorMessage(readError));
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // close() may already have released it.
      }
      if (this.reader === reader) this.reader = null;
    }
  }

  private handleLine(line: string) {
    const parsed = parseReaderLine(line);
    if (!parsed) {
      // Boot and status lines help when diagnosing a reset or a dead port.
      console.debug('[usb-serial]', line.startsWith('{') ? '(unreadable line)' : line);
      this.hooks.onLog(line.startsWith('{') ? '[usb] unreadable line' : line);
      return;
    }
    if ('event' in parsed) {
      if (parsed.event.event === 'ready') this.started?.();
      this.hooks.onEvent(parsed.event);
      return;
    }
    if (!this.tracker.settle(parsed.reply)) {
      // Only the outcome: a late nfc.read reply holds a card link.
      const { id, ok, error } = parsed.reply;
      this.hooks.onLog(`[usb] late reply id=${id ?? '?'} ok=${ok} ${error ?? ''}`.trim());
    }
  }

  async send(cmd: string, extra: Record<string, unknown> = {}, timeoutMs = 6000) {
    const writer = this.writer;
    if (!writer || this.closing || this.lost) throw new LinkClosedError();

    const { id, response } = this.tracker.begin(timeoutMs);
    this.lastSentAt = Date.now();
    try {
      await writer.write(new TextEncoder().encode(JSON.stringify({ id, cmd, ...extra }) + '\n'));
    } catch (writeError) {
      this.tracker.cancel(id, new LinkClosedError());
      this.fail(errorMessage(writeError));
    }
    return response;
  }

  async refreshInfo(): Promise<ReaderResponse> {
    const response = await this.send('info');
    this.info = response.result ?? this.info;
    return response;
  }

  /** Stops the pings, so the reader stops counting this computer as on the cable. */
  setQuiet(quiet: boolean) {
    this.quiet = quiet;
    this.missedPings = 0;
  }

  /** Tells the reader this computer is done, so it need not wait to offer Bluetooth. */
  async release() {
    if (!supportsBluetooth(this.info)) return;
    try {
      await this.send('usb.release', {}, 1000);
    } catch {
      // The reader works it out by itself a few seconds later.
    }
  }

  /** Ends the link as lost, once, and tells whoever owns it. */
  fail(reason: string) {
    if (this.lost || this.closing) return;
    this.lost = true;
    this.tracker.failAll(new LinkClosedError());
    this.hooks.onLost(reason);
  }

  async close() {
    this.closing = true;
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
    this.tracker.failAll(new LinkClosedError());

    const reader = this.reader;
    this.reader = null;
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

    const writer = this.writer;
    this.writer = null;
    try {
      writer?.releaseLock();
    } catch {
      // Already released.
    }

    if (this.opened) {
      this.opened = false;
      try {
        await this.port.close();
      } catch {
        // Already closed.
      }
    }
  }
}
