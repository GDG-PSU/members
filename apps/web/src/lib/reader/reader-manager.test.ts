import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { BluetoothDeviceLike, BluetoothLike } from '@/lib/reader/bluetooth-link';
import { newReaderKey, readerKeyCheck, readerSessionSecrets } from '@/lib/reader/keys';
import { READER_RX, fromBase64Url, toBase64Url } from '@/lib/reader/protocol';
import { ReaderManager, type ReaderDeps, type ReaderSnapshot } from '@/lib/reader/reader-manager';
import type { SerialLike, SerialPortLike } from '@/lib/reader/serial-link';

type Command = { id: number; cmd: string; [key: string]: unknown };
type Reply = Record<string, unknown>;

function seal(key: Buffer, direction: number, counter: bigint, text: string): string {
  const iv = Buffer.alloc(12);
  iv[0] = direction;
  iv.writeBigUInt64BE(counter, 4);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const sealed = Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `#${toBase64Url(Buffer.concat([iv.subarray(4), sealed]))}`;
}

function open(key: Buffer, direction: number, line: string): string {
  const frame = Buffer.from(fromBase64Url(line.slice(1)) ?? []);
  const iv = Buffer.alloc(12);
  iv[0] = direction;
  frame.copy(iv, 4, 0, 8);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(frame.subarray(frame.length - 16));
  return Buffer.concat([
    decipher.update(frame.subarray(8, frame.length - 16)),
    decipher.final(),
  ]).toString('utf8');
}

const OPEN_COMMANDS = new Set(['info', 'ping', 'usb.release']);
const CABLE_ONLY = new Set(['pair.clear', 'bluetooth.set', 'transport.set', 'usb.release']);

/** Firmware 2.2, as far as the browser can tell. */
class FakeReader {
  key: Buffer | null = null;
  epoch = 0;
  mode: 'auto' | 'bluetooth' = 'auto';
  card: string | null = null;
  /** A computer has spoken over the cable and has not let go. */
  cableInUse = false;
  holdReads = false;
  /** Every command the reader acted on, as `link:command`. */
  readonly seen: string[] = [];
  /** Commands that arrived on the cable outside a session. */
  readonly inTheClear: string[] = [];
  bluetooth: FakeBluetoothDevice | null = null;

  constructor(readonly deviceId: string) {}

  get name() {
    return `GDG Reader ${this.deviceId.slice(6, 10).toUpperCase()}`;
  }

  /** Whether the radio is on, by the firmware's rule. */
  get reachable() {
    return this.key !== null && (this.mode === 'bluetooth' || !this.cableInUse);
  }

  /** `sealed` is whether the command came inside an open session. */
  handle(command: Command, link: 'usb' | 'bluetooth', sealed: boolean): Reply | null {
    const ok = (result?: Reply) => ({ id: command.id, ok: true, ...(result ? { result } : {}) });
    const fail = (error: string) => ({ id: command.id, ok: false, error });

    if (link === 'usb') {
      this.cableInUse = command.cmd !== 'usb.release';
      // The cable wins unless the organizer asked for Bluetooth.
      if (this.cableInUse && this.mode === 'auto') this.bluetooth?.dropFromReader('usb');
      if (!sealed) this.inTheClear.push(command.cmd);
    } else if (CABLE_ONLY.has(command.cmd)) {
      return fail('usb_only');
    }
    if (!sealed) {
      const firstKey = command.cmd === 'pair.set' && this.key === null;
      if (!OPEN_COMMANDS.has(command.cmd) && !firstKey) {
        return fail(this.key ? 'locked' : 'not_paired');
      }
    }

    this.seen.push(`${link}:${command.cmd}`);
    switch (command.cmd) {
      case 'info':
        return ok({
          protocol: 4,
          firmware: '2.2.1',
          deviceId: this.deviceId,
          transport: link === 'usb' ? 'usb-serial' : 'bluetooth',
          mode: this.mode,
          locked: this.key !== null && !sealed,
          nfcReady: true,
          bluetooth: {
            name: this.name,
            enabled: true,
            paired: this.key !== null,
            ...(this.key ? { epoch: this.epoch, check: readerKeyCheck(this.key) } : {}),
          },
        });
      case 'ping':
      case 'usb.release':
        return ok();
      case 'pair.set': {
        const epoch = Number(command.epoch);
        if (this.key && epoch <= this.epoch) return fail('bad_epoch');
        this.key = Buffer.from(fromBase64Url(String(command.key)) ?? []);
        this.epoch = epoch;
        return ok({ check: readerKeyCheck(this.key), epoch });
      }
      case 'transport.set':
        this.mode = command.mode === 'bluetooth' ? 'bluetooth' : 'auto';
        if (this.mode === 'auto') this.bluetooth?.dropFromReader('usb');
        return ok();
      case 'nfc.read':
        if (this.holdReads) return null;
        return this.card ? ok({ uri: this.card }) : fail('no_card');
      default:
        return fail('unknown_cmd');
    }
  }
}

/** The reader's half of a session, the way SecureSession does it in the firmware. */
class FakeSession {
  private secure: { key: Buffer; sent: bigint; received: bigint } | null = null;
  private nonces: { client: Uint8Array; reader: Uint8Array } | null = null;

  constructor(private readonly reader: FakeReader) {}

  get isOpen() {
    return this.secure !== null;
  }

  end() {
    this.secure = null;
    this.nonces = null;
  }

  /** Answers a handshake command sent in the clear; null for anything else. */
  auth(command: Command): { reply: Reply; failed: boolean } | null {
    const key = this.reader.key;
    const refuse = (error: string, failed: boolean) => ({
      reply: { id: command.id, ok: false, error },
      failed,
    });

    if (command.cmd === 'auth.begin') {
      if (!key) return refuse('not_paired', false);
      const client = fromBase64Url(String(command.nonce)) ?? new Uint8Array();
      this.nonces = { client, reader: randomBytes(16) };
      return {
        failed: false,
        reply: {
          id: command.id,
          ok: true,
          result: {
            deviceId: this.reader.deviceId,
            epoch: this.reader.epoch,
            nonce: toBase64Url(this.nonces.reader),
          },
        },
      };
    }
    if (command.cmd === 'auth.finish') {
      const nonces = this.nonces;
      this.nonces = null;
      if (!key || !nonces) return refuse('auth_out_of_order', true);
      const secrets = readerSessionSecrets({
        key,
        deviceId: this.reader.deviceId,
        epoch: this.reader.epoch,
        clientNonce: nonces.client,
        readerNonce: nonces.reader,
      });
      if (String(command.proof) !== secrets.clientProof.toString('base64url')) {
        return refuse('auth_failed', true);
      }
      this.secure = { key: secrets.sessionKey, sent: BigInt(0), received: BigInt(0) };
      return {
        failed: false,
        reply: {
          id: command.id,
          ok: true,
          result: { proof: secrets.readerProof.toString('base64url') },
        },
      };
    }
    return null;
  }

  seal(message: Reply): string {
    if (!this.secure) throw new Error('no session to seal with');
    this.secure.sent += BigInt(1);
    return seal(this.secure.key, 2, this.secure.sent, JSON.stringify(message));
  }

  /** Null when the line was not sealed by the session that is open. */
  open(line: string): Command | null {
    if (!this.secure) return null;
    try {
      const frame = fromBase64Url(line.slice(1)) ?? new Uint8Array();
      const counter = Buffer.from(frame).readBigUInt64BE(0);
      if (counter <= this.secure.received) return null;
      const command = JSON.parse(open(this.secure.key, 1, line)) as Command;
      this.secure.received = counter;
      return command;
    } catch {
      return null;
    }
  }
}

class FakeSerialPort implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readonly session: FakeSession;

  constructor(readonly reader: FakeReader) {
    this.session = new FakeSession(reader);
  }

  private say(line: string) {
    this.controller?.enqueue(new TextEncoder().encode(line + '\n'));
  }

  private receive(line: string) {
    if (line.startsWith('#')) {
      const command = this.session.open(line);
      if (!command) {
        this.session.end();
        this.say('{"event":"locked"}');
        return;
      }
      const reply = this.reader.handle(command, 'usb', true);
      if (reply) this.say(this.session.seal(reply));
      if (command.cmd === 'usb.release') this.session.end();
      return;
    }

    const command = JSON.parse(line) as Command;
    const handshake = this.session.auth(command);
    if (handshake) {
      this.reader.cableInUse = true;
      this.say(JSON.stringify(handshake.reply));
      return;
    }
    const reply = this.reader.handle(command, 'usb', false);
    if (reply) this.say(JSON.stringify(reply));
    if (command.cmd === 'usb.release') this.session.end();
  }

  async open() {
    const decoder = new TextDecoder();
    this.session.end();
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        for (const line of decoder.decode(chunk).split('\n')) {
          if (line.trim()) this.receive(line.trim());
        }
      },
    });
  }

  async close() {
    this.reader.cableInUse = false;
  }

  pull() {
    this.reader.cableInUse = false;
    this.controller?.error(new Error('The device has been lost.'));
  }

  /** The reader loses power for a moment and starts again. */
  restart() {
    this.session.end();
    this.say(
      JSON.stringify({
        event: 'ready',
        protocol: 4,
        firmware: '2.2.1',
        deviceId: this.reader.deviceId,
      }),
    );
  }
}

class FakeSerial implements SerialLike {
  ports: FakeSerialPort[] = [];
  private readonly listeners = new Map<string, ((event: Event) => void)[]>();

  async requestPort() {
    const port = this.ports[0];
    if (!port) throw Object.assign(new Error('No port selected'), { name: 'NotFoundError' });
    return port;
  }

  async getPorts() {
    return this.ports;
  }

  addEventListener(type: 'connect' | 'disconnect', listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  plug(port: FakeSerialPort) {
    this.ports = [port];
    for (const listener of this.listeners.get('connect') ?? []) {
      listener({ target: port } as unknown as Event);
    }
  }

  unplug(port: FakeSerialPort) {
    this.ports = [];
    port.pull();
    for (const listener of this.listeners.get('disconnect') ?? []) {
      listener({ target: port } as unknown as Event);
    }
  }
}

class FakeBluetoothDevice implements BluetoothDeviceLike {
  readonly id: string;
  readonly name: string;
  private connected = false;
  private readonly session: FakeSession;
  private buffer = '';
  private gone: (() => void)[] = [];
  private notify: ((event: Event) => void)[] = [];
  private readonly tx: { value: DataView | null } & Record<string, unknown>;
  readonly gatt: NonNullable<BluetoothDeviceLike['gatt']>;

  constructor(readonly reader: FakeReader) {
    this.id = reader.deviceId;
    this.name = reader.name;
    this.session = new FakeSession(reader);
    reader.bluetooth = this;

    this.tx = {
      value: null,
      startNotifications: async () => undefined,
      addEventListener: (_type: string, listener: (event: Event) => void) => {
        this.notify.push(listener);
      },
      removeEventListener: (_type: string, listener: (event: Event) => void) => {
        this.notify = this.notify.filter((entry) => entry !== listener);
      },
    };
    const rx = {
      writeValueWithResponse: async (data: Uint8Array) => {
        if (!this.connected) throw new Error('GATT Server is disconnected.');
        this.buffer += new TextDecoder().decode(data);
        let newline = this.buffer.indexOf('\n');
        while (newline >= 0) {
          const line = this.buffer.slice(0, newline);
          this.buffer = this.buffer.slice(newline + 1);
          this.receive(line);
          newline = this.buffer.indexOf('\n');
        }
      },
      startNotifications: async () => undefined,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const gatt = {
      connected: false,
      connect: async () => {
        // A reader told to listen on Bluetooth is on the air a moment later.
        for (let waited = 0; waited < 150 && !this.reader.reachable; waited += 5) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        if (!this.reader.reachable) throw new Error('Bluetooth device is no longer in range.');
        this.connected = true;
        gatt.connected = true;
        this.session.end();
        this.buffer = '';
        return gatt;
      },
      disconnect: () => this.end(),
      getPrimaryService: async () => ({
        getCharacteristic: async (uuid: string) => (uuid === READER_RX ? rx : this.tx) as never,
      }),
    };
    this.gatt = gatt;
  }

  addEventListener(_type: 'gattserverdisconnected', listener: () => void) {
    this.gone.push(listener);
  }

  removeEventListener(_type: 'gattserverdisconnected', listener: () => void) {
    this.gone = this.gone.filter((entry) => entry !== listener);
  }

  private end() {
    if (!this.connected) return;
    this.connected = false;
    this.gatt.connected = false;
    this.session.end();
    for (const listener of [...this.gone]) listener();
  }

  /** The reader lets go of Bluetooth, saying which link took over. */
  dropFromReader(takenBy: string) {
    if (!this.connected) return;
    this.send({ event: 'transport', to: takenBy });
    this.end();
  }

  private send(message: Reply) {
    const line = this.session.isOpen ? this.session.seal(message) : JSON.stringify(message);
    const bytes = new TextEncoder().encode(line + '\n');
    this.tx.value = new DataView(bytes.buffer);
    for (const listener of [...this.notify]) listener({ target: this.tx } as unknown as Event);
  }

  private receive(line: string) {
    if (this.session.isOpen) {
      // Anything the session did not seal ends it, as on the real reader.
      const command = this.session.open(line);
      if (!command) {
        this.end();
        return;
      }
      const reply = this.reader.handle(command, 'bluetooth', true);
      if (reply) this.send(reply);
      return;
    }

    const command = JSON.parse(line) as Command;
    const handshake = this.session.auth(command);
    if (!handshake) {
      this.send({ id: command.id, ok: false, error: 'auth_required' });
      return;
    }
    // The reader's own proof goes out in the clear; the session is already open.
    const bytes = new TextEncoder().encode(JSON.stringify(handshake.reply) + '\n');
    this.tx.value = new DataView(bytes.buffer);
    for (const listener of [...this.notify]) listener({ target: this.tx } as unknown as Event);
    if (handshake.failed) this.end();
  }
}

class FakeBluetooth implements BluetoothLike {
  /** What the organizer picks in the browser's chooser. */
  choice: FakeBluetoothDevice | null = null;

  async requestDevice() {
    if (!this.choice) throw Object.assign(new Error('User cancelled'), { name: 'NotFoundError' });
    return this.choice;
  }
}

const managers: ReaderManager[] = [];

function setup() {
  const serial = new FakeSerial();
  const bluetooth = new FakeBluetooth();
  /** The website's side: every reader's keys by version, as `reader_keys` holds them. */
  const stored = new Map<string, Map<number, Buffer>>();
  const versions = (deviceId: string) => {
    const known = stored.get(deviceId) ?? new Map<number, Buffer>();
    stored.set(deviceId, known);
    return known;
  };
  const grant = (key: Buffer, epoch: number) => ({
    ok: true as const,
    key: key.toString('base64url'),
    epoch,
    check: readerKeyCheck(key),
  });
  let registrations = 0;

  const deps: ReaderDeps = {
    serial,
    bluetooth,
    releaseAfterMs: 20,
    reconnectForMs: 3000,
    registerReader: async ({ deviceId }) => {
      registrations += 1;
      const known = versions(deviceId);
      const epoch = Math.max(0, ...known.keys()) + 1;
      const key = newReaderKey();
      known.set(epoch, key);
      return grant(key, epoch);
    },
    openSession: async ({ deviceId, epoch, clientNonce, readerNonce }) => {
      const known = versions(deviceId);
      const key = known.get(epoch);
      if (!key) return { ok: false, error: 'This site does not hold this reader’s key.' };
      const secrets = readerSessionSecrets({
        key,
        deviceId,
        epoch,
        clientNonce: fromBase64Url(clientNonce) ?? new Uint8Array(),
        readerNonce: fromBase64Url(readerNonce) ?? new Uint8Array(),
      });
      return {
        ok: true,
        proof: secrets.clientProof.toString('base64url'),
        expect: secrets.readerProof.toString('base64url'),
        sessionKey: secrets.sessionKey.toString('base64url'),
        older: [...known.keys()].some((version) => version < epoch),
      };
    },
    rotateKey: async ({ deviceId, epoch }) => {
      const known = versions(deviceId);
      if (!known.has(epoch)) return { ok: false, error: 'That is not a reader this site knows.' };
      const next = known.get(epoch + 1) ?? newReaderKey();
      known.set(epoch + 1, next);
      return grant(next, epoch + 1);
    },
    confirmKey: async ({ deviceId, epoch }) => {
      const known = versions(deviceId);
      if (!known.has(epoch)) return;
      for (const version of [...known.keys()]) if (version < epoch) known.delete(version);
    },
  };
  const manager = new ReaderManager(deps);
  managers.push(manager);
  const history: ReaderSnapshot[] = [];
  manager.subscribe(() => history.push(manager.getSnapshot()));

  /** A reader that was given its key when it was flashed, as the tool does. */
  const flashed = (deviceId: string): FakeReader => {
    const reader = new FakeReader(deviceId);
    reader.key = newReaderKey();
    reader.epoch = 1;
    versions(deviceId).set(1, reader.key);
    return reader;
  };

  return {
    manager,
    serial,
    bluetooth,
    history,
    flashed,
    /** The versions of a reader's key the website still holds. */
    held: (deviceId: string) => [...versions(deviceId).keys()].sort(),
    keyHeld: (deviceId: string, epoch: number) => versions(deviceId).get(epoch) ?? null,
    hold: (deviceId: string, epoch: number, key: Buffer) => versions(deviceId).set(epoch, key),
    registrations: () => registrations,
  };
}

async function until(condition: () => boolean, what: string) {
  const deadline = Date.now() + 4000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const READER_A = 'esp32-0000000000aa';
const READER_B = 'esp32-0000000000bb';

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.disconnect();
});

describe('the reader connection', () => {
  it('opens a session on the cable, so nothing but the handshake goes in the clear', async () => {
    const { manager, serial, registrations, flashed } = setup();
    const reader = flashed(READER_A);
    reader.card = 'https://example.test/c/token';
    serial.ports = [new FakeSerialPort(reader)];

    manager.retain();
    await until(() => manager.getSnapshot().connected, 'the cable');
    expect(manager.getSnapshot()).toMatchObject({ transport: 'usb', error: '' });
    expect(manager.getSnapshot().info?.locked).toBe(false);

    const read = await manager.send('nfc.read');
    expect(read.result?.uri).toBe('https://example.test/c/token');
    // A reader flashed with its key is never given another one by a page.
    expect(registrations()).toBe(0);
    expect(reader.seen).not.toContain('usb:pair.set');
    expect(new Set(reader.inTheClear)).toEqual(new Set(['info']));
  });

  it('gives a reader that has no key one of its own, over the cable', async () => {
    const { manager, serial, registrations, keyHeld } = setup();
    const reader = new FakeReader(READER_A);
    serial.ports = [new FakeSerialPort(reader)];

    manager.retain();
    await until(() => manager.getSnapshot().connected, 'the cable');
    expect(registrations()).toBe(1);
    expect(reader.epoch).toBe(1);
    expect(reader.key?.equals(keyHeld(READER_A, 1) ?? Buffer.alloc(0))).toBe(true);
    expect(manager.getSnapshot().info?.bluetooth?.paired).toBe(true);
    expect(reader.seen.filter((entry) => entry.endsWith('pair.set'))).toEqual(['usb:pair.set']);
  });

  it('refuses a reader on the cable whose key this site does not hold', async () => {
    const { manager, serial } = setup();
    const stranger = new FakeReader(READER_A);
    stranger.key = newReaderKey();
    stranger.epoch = 3;
    serial.ports = [new FakeSerialPort(stranger)];

    await manager.connectUsb();
    expect(manager.getSnapshot().connected).toBe(false);
    expect(manager.getSnapshot().error).toContain('does not hold this reader');
    // It was asked what it is, and nothing else.
    expect(stranger.seen).toEqual(['usb:info']);
  });

  it('opens a new session when the reader restarts, and sends the command again', async () => {
    const { manager, serial, history, flashed } = setup();
    const reader = flashed(READER_A);
    reader.card = 'https://example.test/c/token';
    const port = new FakeSerialPort(reader);
    serial.ports = [port];
    manager.retain();
    await until(() => manager.getSnapshot().connected, 'the cable');
    history.length = 0;

    reader.holdReads = true;
    const read = manager.send('nfc.read');
    await until(() => reader.seen.includes('usb:nfc.read'), 'the read to start');
    reader.holdReads = false;
    port.restart();

    expect((await read).result?.uri).toBe('https://example.test/c/token');
    expect(history.every((state) => state.connected)).toBe(true);
    expect(manager.getSnapshot().error).toBe('');
  });

  it('gives the reader a new key inside its session and retires the old one', async () => {
    const { manager, serial, bluetooth, held, keyHeld, flashed } = setup();
    const reader = flashed(READER_A);
    reader.card = 'https://example.test/c/token';
    const first = reader.key;
    serial.ports = [new FakeSerialPort(reader)];
    manager.retain();
    await until(() => manager.getSnapshot().connected, 'the cable');

    expect(await manager.rotateKey()).toMatchObject({ ok: true });
    expect(reader.epoch).toBe(2);
    expect(reader.key?.equals(first ?? Buffer.alloc(0))).toBe(false);
    expect(reader.key?.equals(keyHeld(READER_A, 2) ?? Buffer.alloc(0))).toBe(true);
    expect(held(READER_A)).toEqual([2]);
    expect(manager.getSnapshot().info?.bluetooth?.epoch).toBe(2);
    // The new key went inside the session, and the session carries on.
    expect(reader.inTheClear).not.toContain('pair.set');
    expect((await manager.send('nfc.read')).result?.uri).toBe('https://example.test/c/token');

    // The next session, on either link, opens with the new key.
    await manager.disconnect();
    bluetooth.choice = new FakeBluetoothDevice(reader);
    await manager.connectBluetooth();
    expect(manager.getSnapshot()).toMatchObject({ connected: true, transport: 'bluetooth' });
    expect(await manager.rotateKey()).toMatchObject({ ok: true });
    expect(reader.epoch).toBe(3);
    expect(reader.seen).toContain('bluetooth:pair.set');
    expect(held(READER_A)).toEqual([3]);
  });

  it('finishes a key change that was cut short, whichever key the reader ended with', async () => {
    const { manager, serial, held, hold, keyHeld, flashed } = setup();

    // The website stored a new key, but this reader never received it.
    const behind = flashed(READER_A);
    hold(READER_A, 2, newReaderKey());
    serial.ports = [new FakeSerialPort(behind)];
    manager.retain();
    await until(() => manager.getSnapshot().connected, 'the cable');
    expect(held(READER_A)).toEqual([1, 2]);
    // Asking again hands out the key already stored, not a third one.
    const waiting = keyHeld(READER_A, 2);
    expect(await manager.rotateKey()).toMatchObject({ ok: true });
    expect(behind.key?.equals(waiting ?? Buffer.alloc(0))).toBe(true);
    expect(held(READER_A)).toEqual([2]);
    await manager.disconnect();

    // This reader took its new key, but the website never heard that it had.
    const ahead = flashed(READER_B);
    const next = newReaderKey();
    hold(READER_B, 2, next);
    ahead.key = next;
    ahead.epoch = 2;
    serial.ports = [new FakeSerialPort(ahead)];
    await manager.connectUsb();
    expect(manager.getSnapshot().connected).toBe(true);
    await until(() => held(READER_B).length === 1, 'the old key to be retired');
    expect(held(READER_B)).toEqual([2]);
  });

  it('uses Bluetooth when there is no cable, with every line sealed', async () => {
    const { manager, bluetooth, flashed } = setup();
    const reader = flashed(READER_A);
    reader.card = 'https://example.test/c/token';
    bluetooth.choice = new FakeBluetoothDevice(reader);

    await manager.connectBluetooth();
    const state = manager.getSnapshot();
    expect(state).toMatchObject({ connected: true, transport: 'bluetooth', error: '' });
    expect(state.info?.deviceId).toBe(READER_A);
    expect(state.bluetoothChosen).toBe(false);

    const read = await manager.send('nfc.read');
    expect(read.result?.uri).toBe('https://example.test/c/token');
    expect(reader.seen).toContain('bluetooth:nfc.read');
  });

  it('refuses a reader that cannot prove it holds its key', async () => {
    const { manager, bluetooth, flashed } = setup();
    const impostor = flashed(READER_A);
    impostor.key = Buffer.alloc(32, 9);
    bluetooth.choice = new FakeBluetoothDevice(impostor);

    await manager.connectBluetooth();
    const state = manager.getSnapshot();
    expect(state.connected).toBe(false);
    expect(state.error).toContain('did not accept this site');
    // Nothing but the handshake reached it.
    expect(impostor.seen).toEqual([]);
  });

  it('refuses a reader that was never set up', async () => {
    const { manager, bluetooth } = setup();
    const unpaired = new FakeReader(READER_A);
    // The firmware keeps its radio off without a key; this is a reader that does not.
    Object.defineProperty(unpaired, 'reachable', { get: () => true });
    bluetooth.choice = new FakeBluetoothDevice(unpaired);

    await manager.connectBluetooth();
    expect(manager.getSnapshot().connected).toBe(false);
    expect(manager.getSnapshot().error).toContain('has no key yet');
  });

  it('moves to the cable when the reader is plugged in, and finishes the read in flight', async () => {
    const { manager, serial, bluetooth, history, flashed } = setup();
    const reader = flashed(READER_A);
    bluetooth.choice = new FakeBluetoothDevice(reader);
    manager.retain();
    await manager.connectBluetooth();

    reader.holdReads = true;
    const read = manager.send('nfc.read');
    await until(() => reader.seen.includes('bluetooth:nfc.read'), 'the read to start');
    history.length = 0;

    reader.holdReads = false;
    reader.card = 'https://example.test/c/after';
    serial.plug(new FakeSerialPort(reader));

    expect((await read).result?.uri).toBe('https://example.test/c/after');
    expect(manager.getSnapshot().transport).toBe('usb');
    expect(reader.seen).toContain('usb:nfc.read');
    // The page never saw the reader as disconnected.
    expect(history.every((state) => state.connected)).toBe(true);
    expect(bluetooth.choice.gatt.connected).toBe(false);
  });

  it('prefers a reader on the cable even when a different one is on Bluetooth', async () => {
    const { manager, serial, bluetooth, flashed } = setup();
    const wireless = flashed(READER_A);
    const wired = flashed(READER_B);
    bluetooth.choice = new FakeBluetoothDevice(wireless);
    manager.retain();
    await manager.connectBluetooth();

    serial.plug(new FakeSerialPort(wired));
    await until(() => manager.getSnapshot().transport === 'usb', 'the cable');
    expect(manager.getSnapshot().info?.deviceId).toBe(READER_B);
    expect(bluetooth.choice.gatt.connected).toBe(false);
  });

  it('lets the organizer choose Bluetooth with a cable plugged in, and go back', async () => {
    const { manager, serial, bluetooth, flashed } = setup();
    const reader = flashed(READER_A);
    serial.ports = [new FakeSerialPort(reader)];
    manager.retain();
    await until(() => manager.getSnapshot().connected, 'the cable');

    bluetooth.choice = new FakeBluetoothDevice(reader);
    await manager.connectBluetooth();
    expect(manager.getSnapshot()).toMatchObject({
      connected: true,
      transport: 'bluetooth',
      bluetoothChosen: true,
    });
    expect(reader.mode).toBe('bluetooth');

    // A cable being there does not take the choice back.
    reader.card = 'https://example.test/c/token';
    await manager.send('nfc.read');
    expect(reader.seen.at(-1)).toBe('bluetooth:nfc.read');

    await manager.switchToUsb();
    expect(manager.getSnapshot()).toMatchObject({ transport: 'usb', bluetoothChosen: false });
    expect(reader.mode).toBe('auto');
    expect(bluetooth.choice.gatt.connected).toBe(false);
  });

  it('keeps the cable when the Bluetooth chooser is closed', async () => {
    const { manager, serial, flashed } = setup();
    const reader = flashed(READER_A);
    serial.ports = [new FakeSerialPort(reader)];
    manager.retain();
    await until(() => manager.getSnapshot().connected, 'the cable');

    await manager.connectBluetooth();
    expect(manager.getSnapshot()).toMatchObject({ transport: 'usb', error: '' });
    await until(() => reader.mode === 'auto', 'the reader to go back to the cable');
  });

  it('falls back to Bluetooth when the cable is pulled', async () => {
    const { manager, serial, bluetooth, history, flashed } = setup();
    const reader = flashed(READER_A);
    bluetooth.choice = new FakeBluetoothDevice(reader);
    manager.retain();
    await manager.connectBluetooth();
    const port = new FakeSerialPort(reader);
    serial.plug(port);
    await until(() => manager.getSnapshot().transport === 'usb', 'the cable');
    history.length = 0;

    serial.unplug(port);
    await until(() => manager.getSnapshot().transport === 'bluetooth', 'Bluetooth');
    expect(history.every((state) => state.connected)).toBe(true);
    expect(history.some((state) => state.switching)).toBe(true);
  });

  it('goes back to the cable when a chosen Bluetooth link fails', async () => {
    const { manager, serial, bluetooth, flashed } = setup();
    const reader = flashed(READER_A);
    serial.ports = [new FakeSerialPort(reader)];
    manager.retain();
    await until(() => manager.getSnapshot().connected, 'the cable');
    bluetooth.choice = new FakeBluetoothDevice(reader);
    await manager.connectBluetooth();

    bluetooth.choice.gatt.disconnect();
    await until(() => manager.getSnapshot().transport === 'usb', 'the cable');
    expect(manager.getSnapshot()).toMatchObject({ connected: true, bluetoothChosen: false });
    await until(() => reader.mode === 'auto', 'the reader to go back to the cable');
  });

  it('says so when another computer takes the reader by its cable', async () => {
    const { manager, bluetooth, flashed } = setup();
    const reader = flashed(READER_A);
    bluetooth.choice = new FakeBluetoothDevice(reader);
    manager.retain();
    await manager.connectBluetooth();

    // A cable this browser has nothing to do with.
    reader.handle({ id: 1, cmd: 'info' }, 'usb', false);
    await until(() => !manager.getSnapshot().connected, 'the link to end');
    expect(manager.getSnapshot().error).toContain('Another computer');
  });

  it('lets the reader go a moment after the last page using it closes', async () => {
    const { manager, serial, flashed } = setup();
    const reader = flashed(READER_A);
    serial.ports = [new FakeSerialPort(reader)];

    const release = manager.retain();
    await until(() => manager.getSnapshot().connected, 'the cable');
    release();
    // Another page picking it up straight away keeps the link.
    const again = manager.retain();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(manager.getSnapshot().connected).toBe(true);

    again();
    await until(() => !manager.getSnapshot().connected, 'the link to be let go');
    // The reader was told, so it need not wait before offering Bluetooth.
    await until(() => reader.seen.includes('usb:usb.release'), 'the reader to be told');
  });
});
