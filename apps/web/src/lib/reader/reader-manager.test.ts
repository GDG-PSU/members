import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { BluetoothDeviceLike, BluetoothLike } from '@/lib/reader/bluetooth-link';
import {
  READER_KEY_EPOCH,
  deriveReaderKey,
  readerKeyCheck,
  readerSessionSecrets,
} from '@/lib/reader/keys';
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

/** Firmware 2.1.0, as far as the browser can tell. */
class FakeReader {
  key: Buffer | null = null;
  epoch = 0;
  mode: 'auto' | 'bluetooth' = 'auto';
  card: string | null = null;
  /** A computer has spoken over the cable and has not let go. */
  cableInUse = false;
  holdReads = false;
  readonly seen: string[] = [];
  bluetooth: FakeBluetoothDevice | null = null;

  constructor(readonly deviceId: string) {}

  get name() {
    return `GDG Reader ${this.deviceId.slice(-4).toUpperCase()}`;
  }

  /** Whether the radio is on, by the firmware's rule. */
  get reachable() {
    return this.key !== null && (this.mode === 'bluetooth' || !this.cableInUse);
  }

  handle(command: Command, link: 'usb' | 'bluetooth'): Reply | null {
    this.seen.push(`${link}:${command.cmd}`);
    const ok = (result?: Reply) => ({ id: command.id, ok: true, ...(result ? { result } : {}) });
    const fail = (error: string) => ({ id: command.id, ok: false, error });

    if (link === 'usb') {
      this.cableInUse = command.cmd !== 'usb.release';
      // The cable wins unless the organizer asked for Bluetooth.
      if (this.cableInUse && this.mode === 'auto') this.bluetooth?.dropFromReader('usb');
    }
    switch (command.cmd) {
      case 'info':
        return ok({
          protocol: 3,
          firmware: '2.1.0',
          deviceId: this.deviceId,
          transport: link === 'usb' ? 'usb-serial' : 'bluetooth',
          mode: this.mode,
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
      case 'pair.set':
        if (link !== 'usb') return fail('usb_only');
        this.key = Buffer.from(fromBase64Url(String(command.key)) ?? []);
        this.epoch = Number(command.epoch);
        return ok({ check: readerKeyCheck(this.key) });
      case 'transport.set':
        if (link !== 'usb') return fail('usb_only');
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

class FakeSerialPort implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  constructor(readonly reader: FakeReader) {}

  async open() {
    const decoder = new TextDecoder();
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        for (const line of decoder.decode(chunk).split('\n')) {
          if (!line.trim()) continue;
          const reply = this.reader.handle(JSON.parse(line) as Command, 'usb');
          if (reply) {
            this.controller?.enqueue(new TextEncoder().encode(JSON.stringify(reply) + '\n'));
          }
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
  private secure: { key: Buffer; sent: bigint } | null = null;
  private nonces: { client: Uint8Array; reader: Uint8Array } | null = null;
  private buffer = '';
  private gone: (() => void)[] = [];
  private notify: ((event: Event) => void)[] = [];
  private readonly tx: { value: DataView | null } & Record<string, unknown>;
  readonly gatt: NonNullable<BluetoothDeviceLike['gatt']>;

  constructor(readonly reader: FakeReader) {
    this.id = reader.deviceId;
    this.name = reader.name;
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
        if (!this.reader.reachable) throw new Error('Bluetooth device is no longer in range.');
        this.connected = true;
        gatt.connected = true;
        this.secure = null;
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
    this.secure = null;
    for (const listener of [...this.gone]) listener();
  }

  /** The reader lets go of Bluetooth, saying which link took over. */
  dropFromReader(takenBy: string) {
    if (!this.connected) return;
    this.send({ event: 'transport', to: takenBy });
    this.end();
  }

  private send(message: Reply) {
    let line = JSON.stringify(message);
    if (this.secure) {
      this.secure.sent += BigInt(1);
      line = seal(this.secure.key, 2, this.secure.sent, line);
    }
    const bytes = new TextEncoder().encode(line + '\n');
    this.tx.value = new DataView(bytes.buffer);
    for (const listener of [...this.notify]) listener({ target: this.tx } as unknown as Event);
  }

  private receive(line: string) {
    if (this.secure) {
      const reply = this.reader.handle(
        JSON.parse(open(this.secure.key, 1, line)) as Command,
        'bluetooth',
      );
      if (reply) this.send(reply);
      return;
    }

    const command = JSON.parse(line) as Command;
    const key = this.reader.key;
    if (command.cmd === 'auth.begin' && key) {
      const client = fromBase64Url(String(command.nonce)) ?? new Uint8Array();
      this.nonces = { client, reader: randomBytes(16) };
      this.send({
        id: command.id,
        ok: true,
        result: {
          deviceId: this.reader.deviceId,
          epoch: this.reader.epoch,
          nonce: toBase64Url(this.nonces.reader),
        },
      });
    } else if (command.cmd === 'auth.finish' && key && this.nonces) {
      const secrets = readerSessionSecrets({
        key,
        deviceId: this.reader.deviceId,
        epoch: this.reader.epoch,
        clientNonce: this.nonces.client,
        readerNonce: this.nonces.reader,
      });
      if (String(command.proof) !== secrets.clientProof.toString('base64url')) {
        this.send({ id: command.id, ok: false, error: 'auth_failed' });
        this.end();
        return;
      }
      this.send({
        id: command.id,
        ok: true,
        result: { proof: secrets.readerProof.toString('base64url') },
      });
      this.secure = { key: secrets.sessionKey, sent: BigInt(0) };
    } else {
      this.send({ id: command.id, ok: false, error: key ? 'auth_required' : 'not_paired' });
    }
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
  let pairings = 0;
  const deps: ReaderDeps = {
    serial,
    bluetooth,
    releaseAfterMs: 20,
    reconnectForMs: 3000,
    pairReader: async ({ deviceId, epoch, check }) => {
      const key = deriveReaderKey(deviceId);
      if (epoch === READER_KEY_EPOCH && check === readerKeyCheck(key)) {
        return { ok: true, current: true };
      }
      pairings += 1;
      return {
        ok: true,
        current: false,
        key: key.toString('base64url'),
        epoch: READER_KEY_EPOCH,
        check: readerKeyCheck(key),
      };
    },
    openSession: async ({ deviceId, epoch, clientNonce, readerNonce }) => {
      const secrets = readerSessionSecrets({
        key: deriveReaderKey(deviceId),
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
      };
    },
  };
  const manager = new ReaderManager(deps);
  managers.push(manager);
  const history: ReaderSnapshot[] = [];
  manager.subscribe(() => history.push(manager.getSnapshot()));
  return { manager, serial, bluetooth, history, pairings: () => pairings };
}

/** A reader that has already been on an organizer's cable once. */
function pairedReader(deviceId: string): FakeReader {
  const reader = new FakeReader(deviceId);
  reader.key = deriveReaderKey(deviceId);
  reader.epoch = READER_KEY_EPOCH;
  return reader;
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
  it('connects a known reader by its cable and sets it up for Bluetooth', async () => {
    const { manager, serial, pairings } = setup();
    const reader = new FakeReader(READER_A);
    serial.ports = [new FakeSerialPort(reader)];

    manager.retain();
    await until(() => manager.getSnapshot().connected, 'the cable');
    expect(manager.getSnapshot().transport).toBe('usb');

    await until(() => manager.getSnapshot().info?.bluetooth?.paired === true, 'pairing');
    expect(reader.key?.equals(deriveReaderKey(READER_A))).toBe(true);
    expect(pairings()).toBe(1);
    // The key is the only thing sent to set it up, and only over the cable.
    expect(reader.seen.filter((entry) => entry.endsWith('pair.set'))).toEqual(['usb:pair.set']);
  });

  it('does not send a reader the key it already has', async () => {
    const { manager, serial, pairings } = setup();
    const reader = pairedReader(READER_A);
    serial.ports = [new FakeSerialPort(reader)];

    manager.retain();
    await until(() => manager.getSnapshot().connected, 'the cable');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(pairings()).toBe(0);
    expect(reader.seen).not.toContain('usb:pair.set');
  });

  it('uses Bluetooth when there is no cable, with every line sealed', async () => {
    const { manager, bluetooth } = setup();
    const reader = pairedReader(READER_A);
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
    const { manager, bluetooth } = setup();
    const impostor = new FakeReader(READER_A);
    impostor.key = Buffer.alloc(32, 9);
    impostor.epoch = READER_KEY_EPOCH;
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
    expect(manager.getSnapshot().error).toContain('has not been set up for Bluetooth');
  });

  it('moves to the cable when the reader is plugged in, and finishes the read in flight', async () => {
    const { manager, serial, bluetooth, history } = setup();
    const reader = pairedReader(READER_A);
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
    const { manager, serial, bluetooth } = setup();
    const wireless = pairedReader(READER_A);
    const wired = pairedReader(READER_B);
    bluetooth.choice = new FakeBluetoothDevice(wireless);
    manager.retain();
    await manager.connectBluetooth();

    serial.plug(new FakeSerialPort(wired));
    await until(() => manager.getSnapshot().transport === 'usb', 'the cable');
    expect(manager.getSnapshot().info?.deviceId).toBe(READER_B);
    expect(bluetooth.choice.gatt.connected).toBe(false);
  });

  it('lets the organizer choose Bluetooth with a cable plugged in, and go back', async () => {
    const { manager, serial, bluetooth } = setup();
    const reader = pairedReader(READER_A);
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
    const { manager, serial } = setup();
    const reader = pairedReader(READER_A);
    serial.ports = [new FakeSerialPort(reader)];
    manager.retain();
    await until(() => manager.getSnapshot().connected, 'the cable');

    await manager.connectBluetooth();
    expect(manager.getSnapshot()).toMatchObject({ transport: 'usb', error: '' });
    await until(() => reader.mode === 'auto', 'the reader to go back to the cable');
  });

  it('falls back to Bluetooth when the cable is pulled', async () => {
    const { manager, serial, bluetooth, history } = setup();
    const reader = pairedReader(READER_A);
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
    const { manager, serial, bluetooth } = setup();
    const reader = pairedReader(READER_A);
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
    const { manager, bluetooth } = setup();
    const reader = pairedReader(READER_A);
    bluetooth.choice = new FakeBluetoothDevice(reader);
    manager.retain();
    await manager.connectBluetooth();

    // A cable this browser has nothing to do with.
    reader.handle({ id: 1, cmd: 'info' }, 'usb');
    await until(() => !manager.getSnapshot().connected, 'the link to end');
    expect(manager.getSnapshot().error).toContain('Another computer');
  });

  it('lets the reader go a moment after the last page using it closes', async () => {
    const { manager, serial } = setup();
    const reader = pairedReader(READER_A);
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
    expect(reader.seen).toContain('usb:usb.release');
  });
});
