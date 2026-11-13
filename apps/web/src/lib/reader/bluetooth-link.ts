import {
  LinkClosedError,
  RequestTracker,
  errorMessage,
  parseReaderLine,
  type LinkHooks,
  type ReaderLink,
} from '@/lib/reader/link';
import { openReaderSession, type ReaderBroker } from '@/lib/reader/handshake';
import {
  LineBuffer,
  READER_RX,
  READER_SERVICE,
  READER_TX,
  type ReaderInfo,
  type ReaderResponse,
} from '@/lib/reader/protocol';
import type { SecureChannel } from '@/lib/reader/secure-channel';

type CharacteristicLike = {
  value?: DataView | null;
  writeValueWithResponse?(data: Uint8Array<ArrayBuffer>): Promise<void>;
  writeValue?(data: Uint8Array<ArrayBuffer>): Promise<void>;
  startNotifications(): Promise<unknown>;
  addEventListener(type: 'characteristicvaluechanged', listener: (event: Event) => void): void;
  removeEventListener(type: 'characteristicvaluechanged', listener: (event: Event) => void): void;
};

type GattServerLike = {
  connected: boolean;
  connect(): Promise<GattServerLike>;
  disconnect(): void;
  getPrimaryService(
    uuid: string,
  ): Promise<{ getCharacteristic(uuid: string): Promise<CharacteristicLike> }>;
};

export type BluetoothDeviceLike = {
  id: string;
  name?: string | null;
  gatt?: GattServerLike | null;
  addEventListener(type: 'gattserverdisconnected', listener: () => void): void;
  removeEventListener(type: 'gattserverdisconnected', listener: () => void): void;
};

export type BluetoothLike = {
  requestDevice(options: { filters: { services: string[] }[] }): Promise<BluetoothDeviceLike>;
  /** Readers this site was already allowed to use. Not in every browser. */
  getDevices?(): Promise<BluetoothDeviceLike[]>;
};

// One write the stack can carry whatever was negotiated, well under the 512-byte
// limit on a characteristic value.
const WRITE_BYTES = 180;
const CONNECT_TIMEOUT_MS = 15_000;

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * The reader over Bluetooth Low Energy, through Web Bluetooth.
 *
 * Anyone nearby can connect to a Bluetooth device, and anyone can pretend to be
 * one, so nothing is sent until a session is open (handshake.ts).
 */
export class BluetoothLink implements ReaderLink {
  readonly transport = 'bluetooth' as const;
  info: ReaderInfo | null = null;

  private readonly tracker = new RequestTracker();
  private readonly lines = new LineBuffer();
  private readonly decoder = new TextDecoder();
  private rx: CharacteristicLike | null = null;
  private tx: CharacteristicLike | null = null;
  private channel: SecureChannel | null = null;
  private inbox: Promise<void> = Promise.resolve();
  private outbox: Promise<void> = Promise.resolve();
  private closing = false;
  private lost = false;

  private constructor(
    readonly device: BluetoothDeviceLike,
    private readonly hooks: LinkHooks,
  ) {}

  static async open(
    device: BluetoothDeviceLike,
    broker: ReaderBroker,
    hooks: LinkHooks,
    connectTimeoutMs = CONNECT_TIMEOUT_MS,
  ): Promise<BluetoothLink> {
    const link = new BluetoothLink(device, hooks);
    try {
      await link.start(broker, connectTimeoutMs);
    } catch (error) {
      await link.close();
      throw error;
    }
    return link;
  }

  private async start(broker: ReaderBroker, connectTimeoutMs: number) {
    const gatt = this.device.gatt;
    if (!gatt) throw new Error('This reader cannot be reached over Bluetooth.');

    this.hooks.onStatus('Connecting by Bluetooth…');
    this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
    const server = await withTimeout(
      gatt.connect(),
      connectTimeoutMs,
      'The reader did not answer over Bluetooth. Check that it has power and is nearby.',
    );
    const service = await server.getPrimaryService(READER_SERVICE);
    this.rx = await service.getCharacteristic(READER_RX);
    this.tx = await service.getCharacteristic(READER_TX);
    this.tx.addEventListener('characteristicvaluechanged', this.onValue);
    await this.tx.startNotifications();

    this.hooks.onStatus('Checking the reader…');
    this.channel = await openReaderSession((cmd, extra) => this.send(cmd, extra), broker);

    const info = await this.send('info');
    this.info = info.result ?? null;
  }

  private readonly onDisconnected = () => {
    // Whatever the reader said before it went is read first: it may say why.
    void this.inbox.then(() => this.fail('The Bluetooth connection to the reader was lost.'));
  };

  private readonly onValue = (event: Event) => {
    const value = (event.target as CharacteristicLike | null)?.value;
    if (!value) return;
    const text = this.decoder.decode(value, { stream: true });
    for (const line of this.lines.push(text)) {
      // Opening a sealed line is asynchronous, and lines must stay in order.
      this.inbox = this.inbox.then(() => this.handleLine(line)).catch(() => {});
    }
  };

  private async handleLine(received: string) {
    if (this.closing || this.lost) return;
    let line = received;
    if (this.channel) {
      try {
        line = await this.channel.open(received);
      } catch (openError) {
        // Forged, corrupted or replayed: nothing after it can be trusted either.
        this.fail(errorMessage(openError));
        this.device.gatt?.disconnect();
        return;
      }
    }

    const parsed = parseReaderLine(line);
    if (!parsed) {
      this.hooks.onLog('[bluetooth] unreadable line');
      return;
    }
    if ('event' in parsed) {
      this.hooks.onEvent(parsed.event);
      return;
    }
    if (!this.tracker.settle(parsed.reply)) {
      const { id, ok, error } = parsed.reply;
      this.hooks.onLog(`[bluetooth] late reply id=${id ?? '?'} ok=${ok} ${error ?? ''}`.trim());
    }
  }

  private write(text: string): Promise<void> {
    const sent = this.outbox.then(async () => {
      const rx = this.rx;
      if (!rx || this.closing || this.lost) throw new LinkClosedError();
      // Sealed here, in the queue, so the counters go out in the order they were made.
      const line = this.channel ? await this.channel.seal(text) : text;
      const data = new TextEncoder().encode(line + '\n');
      for (let offset = 0; offset < data.length; offset += WRITE_BYTES) {
        const chunk = data.slice(offset, offset + WRITE_BYTES);
        if (rx.writeValueWithResponse) {
          await rx.writeValueWithResponse(chunk);
        } else if (rx.writeValue) {
          await rx.writeValue(chunk);
        } else {
          throw new Error('This browser cannot write to the reader.');
        }
      }
    });
    // One failed write must not block the ones queued behind it.
    this.outbox = sent.catch(() => {});
    return sent;
  }

  async send(
    cmd: string,
    extra: Record<string, unknown> = {},
    timeoutMs = 6000,
  ): Promise<ReaderResponse> {
    if (this.closing || this.lost) throw new LinkClosedError();
    const { id, response } = this.tracker.begin(timeoutMs);
    try {
      await this.write(JSON.stringify({ id, cmd, ...extra }));
    } catch (writeError) {
      const closed = writeError instanceof LinkClosedError || !this.device.gatt?.connected;
      this.tracker.cancel(id, closed ? new LinkClosedError() : new Error(errorMessage(writeError)));
      if (closed) this.fail('The Bluetooth connection to the reader was lost.');
    }
    return response;
  }

  async refreshInfo(): Promise<ReaderResponse> {
    const response = await this.send('info');
    this.info = response.result ?? this.info;
    return response;
  }

  private fail(reason: string) {
    if (this.lost || this.closing) return;
    this.lost = true;
    this.tracker.failAll(new LinkClosedError());
    this.hooks.onLost(reason);
  }

  async close() {
    this.closing = true;
    this.tracker.failAll(new LinkClosedError());
    this.device.removeEventListener('gattserverdisconnected', this.onDisconnected);
    this.tx?.removeEventListener('characteristicvaluechanged', this.onValue);
    this.channel = null;
    try {
      this.device.gatt?.disconnect();
    } catch {
      // Already disconnected.
    }
  }
}
