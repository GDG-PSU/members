import { NOT_OURS, openReaderSession, type ReaderBroker } from '@/lib/reader/handshake';
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
  isSecureReader,
  sendsKeepAlive,
  type ReaderInfo,
  type ReaderResponse,
} from '@/lib/reader/protocol';
import type { SecureChannel } from '@/lib/reader/secure-channel';

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

/** The reader dropped its session, so what was sent in it was not acted on. */
class SessionResetError extends Error {}

/**
 * The reader on its USB cable, through Web Serial.
 *
 * A reader with firmware 2.2.0 or later obeys only a session opened with its
 * key, so this opens one as soon as the reader answers (handshake.ts) and seals
 * every command after that. If the reader restarts, it says so and the session
 * is opened again without the pages noticing. Older firmware has no key and is
 * spoken to in the clear.
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
  private channel: SecureChannel | null = null;
  /** A session is being opened; commands wait for it. */
  private securing: Promise<void> | null = null;
  private inbox: Promise<void> = Promise.resolve();
  private outbox: Promise<void> = Promise.resolve();
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
    private readonly broker: ReaderBroker,
  ) {}

  static async open(
    port: SerialPortLike,
    hooks: LinkHooks,
    broker: ReaderBroker,
  ): Promise<SerialLink> {
    const link = new SerialLink(port, hooks, broker);
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
    const early = this.transmit('info', {}, BOOT_WAIT_MS, false).catch(() => null);
    let response = await Promise.race([
      early,
      startedAgain.then(() => null),
      sleep(BOOT_WAIT_MS).then(() => null),
    ]);
    this.started = null;

    let lastError: unknown = null;
    for (let attempt = 0; !response && attempt < 3; attempt += 1) {
      try {
        response = await this.transmit('info', {}, 8000, false);
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
    if (isSecureReader(this.info)) {
      this.hooks.onStatus('Checking the reader…');
      await this.secure(this.info);
    }
    if (sendsKeepAlive(this.info)) {
      this.keepAlive = setInterval(() => this.ping(), KEEP_ALIVE_MS);
    }
  }

  /**
   * Opens a session. A reader with no key is given one first: it takes its
   * first key from whoever holds its cable, and nothing else until it has one.
   */
  private async secure(known?: ReaderInfo | null) {
    this.channel = null;
    const info = known ?? (await this.transmit('info', {}, 8000, false)).result ?? null;
    if (!info?.deviceId) throw new Error(NOT_OURS);

    if (!info.bluetooth?.paired) {
      this.hooks.onStatus('Setting up the reader…');
      const grant = await this.broker.registerReader({ deviceId: info.deviceId });
      if (!grant.ok) throw new Error(grant.error);
      const kept = await this.transmit(
        'pair.set',
        { key: grant.key, epoch: grant.epoch },
        4000,
        false,
      );
      if (kept.result?.check !== grant.check) throw new Error('The reader did not keep its key.');
      this.hooks.onLog('[usb] This reader now has a key and is locked to this site.');
    }

    this.channel = await openReaderSession(
      (cmd, extra) => this.transmit(cmd, extra, 6000, false),
      this.broker,
    );
    const sealed = await this.transmit('info', {}, 6000, true);
    this.info = sealed.result ?? info;
  }

  /** The reader has no session any more, usually because it restarted. */
  private resecure() {
    if (this.securing || this.closing || this.lost || !isSecureReader(this.info)) return;
    this.channel = null;
    // What was sent into the old session was not acted on; send() tries again.
    this.tracker.failAll(new SessionResetError());
    const work = this.secure().finally(() => {
      if (this.securing === work) this.securing = null;
    });
    this.securing = work;
    work.catch((error: unknown) => this.fail(errorMessage(error)));
  }

  private ping() {
    if (this.quiet || this.closing || this.lost || this.securing || this.tracker.busy) return;
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
          // Opening a sealed line is asynchronous, and lines must stay in order.
          this.inbox = this.inbox.then(() => this.handleLine(line)).catch(() => {});
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

  private async handleLine(received: string) {
    if (this.closing || this.lost) return;
    let line = received;
    const sealed = received.startsWith('#');
    if (sealed) {
      const channel = this.channel;
      if (!channel) return;
      try {
        line = await channel.open(received);
      } catch {
        // Forged, corrupted or replayed: start again from a fresh session.
        this.hooks.onLog('[usb] a sealed line could not be verified');
        this.resecure();
        return;
      }
    }

    const parsed = parseReaderLine(line);
    if (!parsed) {
      if (sealed) return;
      // Boot and status lines help when diagnosing a reset or a dead port.
      console.debug('[usb-serial]', line.startsWith('{') ? '(unreadable line)' : line);
      this.hooks.onLog(line.startsWith('{') ? '[usb] unreadable line' : line);
      return;
    }
    if ('event' in parsed) {
      const name = parsed.event.event;
      if (name === 'ready') this.started?.();
      // A restart ends the session the reader had; so does it saying so.
      if ((name === 'ready' && this.channel) || name === 'locked') this.resecure();
      this.hooks.onEvent(parsed.event);
      return;
    }
    // Once a session is open, only what it sealed is the reader's word.
    if (this.channel && !sealed) return;
    if (!this.tracker.settle(parsed.reply)) {
      // Only the outcome: a late nfc.read reply holds a card link.
      const { id, ok, error } = parsed.reply;
      this.hooks.onLog(`[usb] late reply id=${id ?? '?'} ok=${ok} ${error ?? ''}`.trim());
    }
  }

  /** Writes one command, sealed or in the clear, and resolves with its reply. */
  private async transmit(
    cmd: string,
    extra: Record<string, unknown>,
    timeoutMs: number,
    sealed: boolean,
  ): Promise<ReaderResponse> {
    if (!this.writer || this.closing || this.lost) throw new LinkClosedError();

    const { id, response } = this.tracker.begin(timeoutMs);
    this.lastSentAt = Date.now();
    const text = JSON.stringify({ id, cmd, ...extra });
    const sent = this.outbox.then(async () => {
      const writer = this.writer;
      if (!writer || this.closing || this.lost) throw new LinkClosedError();
      // Sealed here, in the queue, so the counters go out in the order they were made.
      const channel = sealed ? this.channel : null;
      if (sealed && !channel) throw new SessionResetError();
      const line = channel ? await channel.seal(text) : text;
      await writer.write(new TextEncoder().encode(line + '\n'));
    });
    // One failed write must not block the ones queued behind it.
    this.outbox = sent.catch(() => {});
    try {
      await sent;
    } catch (writeError) {
      if (writeError instanceof SessionResetError || writeError instanceof LinkClosedError) {
        this.tracker.cancel(id, writeError);
      } else {
        this.tracker.cancel(id, new LinkClosedError());
        this.fail(errorMessage(writeError));
      }
    }
    return response;
  }

  async send(
    cmd: string,
    extra: Record<string, unknown> = {},
    timeoutMs = 6000,
  ): Promise<ReaderResponse> {
    const needsSession = isSecureReader(this.info);
    for (let attempt = 0; ; attempt += 1) {
      if (this.securing) {
        try {
          await this.securing;
        } catch {
          throw new LinkClosedError();
        }
      }
      try {
        return await this.transmit(cmd, extra, timeoutMs, needsSession);
      } catch (error) {
        // The reader restarted under the command: send it into the new session.
        if (!(error instanceof SessionResetError)) throw error;
        if (attempt >= 2 || !this.securing) throw new LinkClosedError();
      }
    }
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

  /**
   * Tells the reader this computer is done. It ends the session, so whoever
   * plugs in next starts from nothing, and need not wait to offer Bluetooth.
   */
  async release() {
    if (!sendsKeepAlive(this.info)) return;
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
    this.channel = null;

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
