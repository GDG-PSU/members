import type { Page } from '@playwright/test';

export const FAKE_READER_ID = 'esp32-0000e2e00001';

/** What a test can do to the stand-in reader from outside the page. */
export type FakeReaderAction =
  /** The cable goes into this computer. */
  | 'plug'
  /** The cable comes out; the reader keeps its power. */
  | 'unplug'
  /** The reader loses power for a moment and starts again. */
  | 'restart'
  /** The reader now holds a key the website never stored. */
  | 'swapKey'
  | 'restoreKey'
  /** The organizer closes the browser's Bluetooth chooser without choosing. */
  | 'closeChooser'
  | 'openChooser';

/**
 * A stand-in for a reader with firmware 2.2.0, whose card contents the test
 * controls through `window.__cardUri`. It has a cable (Web Serial) and a radio
 * (Web Bluetooth), obeys only a session opened with its key on either, follows
 * the firmware's rule for when the radio is on, and does the real handshake and
 * sealing, so the page's own code is what is tested.
 */
export async function installFakeReader(page: Page) {
  await page.addInitScript((deviceId) => {
    type Command = { id: number; cmd: string; [key: string]: unknown };
    type Reply = Record<string, unknown>;

    const RX = '7c1f0002-5b0a-4f6e-9a54-6d5b2c8e41a7';
    const KEY_ITEM = '__readerKey';
    const OPEN_COMMANDS = ['info', 'ping', 'usb.release'];
    const CABLE_ONLY = ['pair.clear', 'transport.set', 'usb.release', 'bluetooth.set'];
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const state = window as unknown as {
      __cardUri: string | null;
      __corruptWrites?: boolean;
      __reader: Record<string, unknown>;
    };
    state.__cardUri = null;

    const toBase64Url = (bytes: Uint8Array) => {
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const fromBase64Url = (text: string) => {
      const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
      return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    };
    const concat = (...parts: Uint8Array[]) => {
      const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
      let offset = 0;
      for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
      }
      return out;
    };
    const hmac = async (key: Uint8Array, message: Uint8Array) => {
      const imported = await crypto.subtle.importKey(
        'raw',
        key as BufferSource,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      return new Uint8Array(await crypto.subtle.sign('HMAC', imported, message as BufferSource));
    };
    const nonceFor = (direction: number, counter: bigint) => {
      const bytes = new Uint8Array(12);
      bytes[0] = direction;
      new DataView(bytes.buffer).setBigUint64(4, counter);
      return bytes;
    };

    // The key outlives a page load, as it does in the reader's own storage.
    const reader = {
      mode: 'auto' as 'auto' | 'bluetooth',
      cableInUse: false,
      /** Every line that went over the air, as an eavesdropper would see it. */
      air: [] as string[],
      /** Every line that went down the cable, in either direction. */
      cable: [] as string[],
      key: () => {
        const stored = localStorage.getItem(KEY_ITEM);
        return stored ? fromBase64Url(stored) : null;
      },
      epoch: () => Number(localStorage.getItem(`${KEY_ITEM}Epoch`) ?? 0),
      reachable: () => reader.key() !== null && (reader.mode === 'bluetooth' || !reader.cableInUse),
      check: async () => {
        const key = reader.key();
        if (!key) return undefined;
        const digest = await hmac(key, encoder.encode('gdg-reader-kcv-v1'));
        return Array.from(digest.subarray(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join(
          '',
        );
      },
      /** `sealed` is whether the command came inside an open session. */
      handle: async (
        command: Command,
        link: 'usb' | 'bluetooth',
        sealed: boolean,
      ): Promise<Reply> => {
        const ok = (result?: Reply) => ({
          id: command.id,
          ok: true,
          ...(result ? { result } : {}),
        });
        const fail = (error: string) => ({ id: command.id, ok: false, error });
        if (link === 'bluetooth' && CABLE_ONLY.includes(command.cmd)) return fail('usb_only');

        if (link === 'usb') {
          reader.cableInUse = command.cmd !== 'usb.release';
          // The cable wins unless the organizer asked for Bluetooth.
          if (reader.cableInUse && reader.mode === 'auto') radio.dropFromReader('usb');
        }
        if (!sealed) {
          const firstKey = command.cmd === 'pair.set' && reader.key() === null;
          if (!OPEN_COMMANDS.includes(command.cmd) && !firstKey) {
            return fail(reader.key() ? 'locked' : 'not_paired');
          }
        }

        switch (command.cmd) {
          case 'info':
            return ok({
              protocol: 4,
              firmware: '2.2.0',
              deviceId,
              transport: link === 'usb' ? 'usb-serial' : 'bluetooth',
              mode: reader.mode,
              locked: reader.key() !== null && !sealed,
              nfcReady: true,
              bluetooth: {
                name: 'GDG Reader 0000',
                enabled: true,
                paired: reader.key() !== null,
                ...(reader.key() ? { epoch: reader.epoch(), check: await reader.check() } : {}),
              },
            });
          case 'ping':
          case 'usb.release':
            return ok();
          case 'pair.set':
            if (reader.key() && Number(command.epoch) <= reader.epoch()) return fail('bad_epoch');
            localStorage.setItem(KEY_ITEM, String(command.key));
            localStorage.setItem(`${KEY_ITEM}Epoch`, String(command.epoch));
            return ok({ check: await reader.check(), epoch: reader.epoch() });
          case 'transport.set':
            reader.mode = command.mode === 'bluetooth' ? 'bluetooth' : 'auto';
            if (reader.mode === 'auto') radio.dropFromReader('usb');
            return ok();
          case 'nfc.write':
            state.__cardUri = state.__corruptWrites
              ? `${String(command.uri)}#corrupt`
              : String(command.uri ?? '');
            return ok({ readBack: true });
          case 'nfc.read':
            if (state.__cardUri?.startsWith('error:')) return fail(state.__cardUri.slice(6));
            return state.__cardUri ? ok({ uri: state.__cardUri }) : fail('no_card');
          default:
            return fail('unknown_cmd');
        }
      },
    };

    /** The reader's half of a session, as SecureSession does it in the firmware. */
    const makeSession = () => {
      let secure: { key: CryptoKey; sent: bigint; received: bigint } | null = null;
      let nonces: { client: Uint8Array; reader: Uint8Array } | null = null;

      const proofFor = async (label: string) => {
        const key = reader.key();
        if (!key || !nonces) return new Uint8Array();
        const transcript = encoder.encode(
          `${label}\0gdg-reader-auth-v1\0${deviceId}\0${reader.epoch()}\0`,
        );
        return hmac(key, concat(transcript, nonces.client, nonces.reader));
      };

      return {
        isOpen: () => secure !== null,
        end: () => {
          secure = null;
          nonces = null;
        },
        /** Answers a handshake command sent in the clear; null for anything else. */
        auth: async (command: Command): Promise<{ reply: Reply; failed: boolean } | null> => {
          const refuse = (error: string, failed: boolean) => ({
            reply: { id: command.id, ok: false, error },
            failed,
          });
          if (command.cmd === 'auth.begin') {
            if (!reader.key()) return refuse('not_paired', false);
            nonces = {
              client: fromBase64Url(String(command.nonce)),
              reader: crypto.getRandomValues(new Uint8Array(16)),
            };
            return {
              failed: false,
              reply: {
                id: command.id,
                ok: true,
                result: { deviceId, epoch: reader.epoch(), nonce: toBase64Url(nonces.reader) },
              },
            };
          }
          if (command.cmd === 'auth.finish') {
            if (!reader.key() || !nonces) return refuse('auth_out_of_order', true);
            if (String(command.proof) !== toBase64Url(await proofFor('client'))) {
              nonces = null;
              return refuse('auth_failed', true);
            }
            const sessionKey = await crypto.subtle.importKey(
              'raw',
              (await proofFor('session')) as BufferSource,
              { name: 'AES-GCM' },
              false,
              ['encrypt', 'decrypt'],
            );
            const proof = toBase64Url(await proofFor('reader'));
            nonces = null;
            secure = { key: sessionKey, sent: BigInt(0), received: BigInt(0) };
            return { failed: false, reply: { id: command.id, ok: true, result: { proof } } };
          }
          return null;
        },
        seal: async (message: Reply): Promise<string> => {
          if (!secure) throw new Error('no session to seal with');
          secure.sent += BigInt(1);
          const iv = nonceFor(2, secure.sent);
          const sealed = new Uint8Array(
            await crypto.subtle.encrypt(
              { name: 'AES-GCM', iv },
              secure.key,
              encoder.encode(JSON.stringify(message)),
            ),
          );
          return `#${toBase64Url(concat(iv.subarray(4), sealed))}`;
        },
        /** Null when the line was not sealed by the session that is open. */
        unseal: async (line: string): Promise<Command | null> => {
          if (!secure) return null;
          try {
            const frame = fromBase64Url(line.slice(1));
            const counter = new DataView(frame.buffer).getBigUint64(0);
            if (counter <= secure.received) return null;
            const plain = await crypto.subtle.decrypt(
              { name: 'AES-GCM', iv: nonceFor(1, counter) },
              secure.key,
              frame.subarray(8),
            );
            secure.received = counter;
            return JSON.parse(decoder.decode(plain)) as Command;
          } catch {
            return null;
          }
        },
      };
    };

    /* ------------------------------ the cable ------------------------------ */

    const serialListeners: Record<string, ((event: Event) => void)[]> = {
      connect: [],
      disconnect: [],
    };
    let plugged = true;
    // A real browser only tells a page about ports it was already allowed to use.
    let permitted = false;
    const cableSession = makeSession();

    class FakeSerialPort {
      readable: ReadableStream<Uint8Array> | null = null;
      writable: WritableStream<Uint8Array> | null = null;
      private controller: ReadableStreamDefaultController<Uint8Array> | null = null;

      say(line: string) {
        reader.cable.push(line);
        this.controller?.enqueue(encoder.encode(line + '\n'));
      }

      private async receive(line: string) {
        reader.cable.push(line);
        if (line.startsWith('#')) {
          const command = await cableSession.unseal(line);
          if (!command) {
            cableSession.end();
            this.say('{"event":"locked"}');
            return;
          }
          this.say(await cableSession.seal(await reader.handle(command, 'usb', true)));
          if (command.cmd === 'usb.release') cableSession.end();
          return;
        }

        const command = JSON.parse(line) as Command;
        const handshake = await cableSession.auth(command);
        if (handshake) {
          reader.cableInUse = true;
          this.say(JSON.stringify(handshake.reply));
          return;
        }
        this.say(JSON.stringify(await reader.handle(command, 'usb', false)));
        if (command.cmd === 'usb.release') cableSession.end();
      }

      async open() {
        if (!plugged) throw new Error('The device has been lost.');
        // Opening the port restarts a real reader, which ends any session.
        cableSession.end();
        this.readable = new ReadableStream<Uint8Array>({
          start: (controller) => {
            this.controller = controller;
          },
        });
        this.writable = new WritableStream<Uint8Array>({
          write: async (chunk) => {
            for (const line of decoder.decode(chunk).split('\n')) {
              if (line.trim()) await this.receive(line.trim());
            }
          },
        });
      }

      async close() {
        reader.cableInUse = false;
      }

      pull() {
        reader.cableInUse = false;
        try {
          this.controller?.error(new Error('The device has been lost.'));
        } catch {
          // The port was not open.
        }
      }

      restart() {
        cableSession.end();
        reader.mode = 'auto';
        radio.end();
        this.say(JSON.stringify({ event: 'ready', protocol: 4, firmware: '2.2.0', deviceId }));
      }

      getInfo() {
        return { usbVendorId: 0x10c4, usbProductId: 0xea60 };
      }
    }
    const port = new FakeSerialPort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: async () => {
          if (!plugged) {
            throw Object.assign(new Error('No port selected.'), { name: 'NotFoundError' });
          }
          permitted = true;
          return port;
        },
        getPorts: async () => (plugged && permitted ? [port] : []),
        addEventListener: (type: string, listener: (event: Event) => void) => {
          serialListeners[type]?.push(listener);
        },
      },
    });

    /* ------------------------------ the radio ------------------------------ */

    let chooserOpen = true;
    let connected = false;
    const airSession = makeSession();
    let incoming = '';
    let work: Promise<void> = Promise.resolve();
    let goneListeners: (() => void)[] = [];
    let valueListeners: ((event: Event) => void)[] = [];
    const tx = {
      value: null as DataView | null,
      startNotifications: async () => undefined,
      addEventListener: (_type: string, listener: (event: Event) => void) => {
        valueListeners.push(listener);
      },
      removeEventListener: (_type: string, listener: (event: Event) => void) => {
        valueListeners = valueListeners.filter((entry) => entry !== listener);
      },
    };

    const radio = {
      end: () => {
        if (!connected) return;
        connected = false;
        gatt.connected = false;
        airSession.end();
        for (const listener of [...goneListeners]) listener();
      },
      say: (line: string) => {
        reader.air.push(line);
        const bytes = encoder.encode(line + '\n');
        tx.value = new DataView(bytes.buffer);
        for (const listener of [...valueListeners]) listener({ target: tx } as unknown as Event);
      },
      send: async (message: Reply) => {
        radio.say(airSession.isOpen() ? await airSession.seal(message) : JSON.stringify(message));
      },
      /** The reader lets go of Bluetooth, saying which link took over. */
      dropFromReader: (takenBy: string) => {
        if (!connected) return;
        work = work.then(async () => {
          await radio.send({ event: 'transport', to: takenBy });
          radio.end();
        });
      },
      receive: async (line: string) => {
        reader.air.push(line);
        if (airSession.isOpen()) {
          // Anything the session did not seal ends it, as on the real reader.
          const command = await airSession.unseal(line);
          if (!command) {
            radio.end();
            return;
          }
          await radio.send(await reader.handle(command, 'bluetooth', true));
          return;
        }

        const command = JSON.parse(line) as Command;
        const handshake = await airSession.auth(command);
        if (!handshake) {
          await radio.send({ id: command.id, ok: false, error: 'auth_required' });
          return;
        }
        // The reader's own proof goes out in the clear; the session is already open.
        radio.say(JSON.stringify(handshake.reply));
        if (handshake.failed) radio.end();
      },
    };

    const rx = {
      writeValueWithResponse: async (data: Uint8Array) => {
        if (!connected) throw new Error('GATT Server is disconnected.');
        incoming += decoder.decode(data);
        let newline = incoming.indexOf('\n');
        while (newline >= 0) {
          const line = incoming.slice(0, newline);
          incoming = incoming.slice(newline + 1);
          work = work.then(() => radio.receive(line)).catch(() => radio.end());
          newline = incoming.indexOf('\n');
        }
        await work;
      },
    };
    const gatt = {
      connected: false,
      connect: async () => {
        if (!reader.reachable()) throw new Error('Bluetooth Device is no longer in range.');
        connected = true;
        gatt.connected = true;
        airSession.end();
        incoming = '';
        return gatt;
      },
      disconnect: () => radio.end(),
      getPrimaryService: async () => ({
        getCharacteristic: async (uuid: string) => (uuid === RX ? rx : tx),
      }),
    };
    const device = {
      id: 'fake-reader',
      name: 'GDG Reader 0000',
      gatt,
      addEventListener: (_type: string, listener: () => void) => {
        goneListeners.push(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        goneListeners = goneListeners.filter((entry) => entry !== listener);
      },
    };
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        requestDevice: async () => {
          // An organizer takes a moment to choose, and only sees a reader that is on the air.
          await new Promise((resolve) => setTimeout(resolve, 150));
          if (!chooserOpen || !reader.reachable()) {
            throw Object.assign(new Error('User cancelled the chooser.'), {
              name: 'NotFoundError',
            });
          }
          return device;
        },
      },
    });

    /* ------------------------- what a test can do -------------------------- */

    state.__reader = {
      air: reader.air,
      cable: reader.cable,
      epoch: () => reader.epoch(),
      plug: () => {
        plugged = true;
        if (permitted) {
          for (const listener of serialListeners.connect ?? []) {
            listener({ target: port } as unknown as Event);
          }
        }
      },
      unplug: () => {
        plugged = false;
        port.pull();
        for (const listener of serialListeners.disconnect ?? []) {
          listener({ target: port } as unknown as Event);
        }
      },
      restart: () => port.restart(),
      swapKey: () => {
        localStorage.setItem(`${KEY_ITEM}Real`, localStorage.getItem(KEY_ITEM) ?? '');
        localStorage.setItem(KEY_ITEM, toBase64Url(crypto.getRandomValues(new Uint8Array(32))));
      },
      restoreKey: () => {
        localStorage.setItem(KEY_ITEM, localStorage.getItem(`${KEY_ITEM}Real`) ?? '');
      },
      closeChooser: () => {
        chooserOpen = false;
      },
      openChooser: () => {
        chooserOpen = true;
      },
    };
  }, FAKE_READER_ID);
}

export async function setCard(page: Page, uri: string | null) {
  await page.evaluate((value) => {
    (window as unknown as { __cardUri: string | null }).__cardUri = value;
  }, uri);
}

export async function fakeReader(page: Page, action: FakeReaderAction) {
  await page.evaluate((name) => {
    (window as unknown as { __reader: Record<string, () => void> }).__reader[name]?.();
  }, action);
}

/** Everything the reader's radio carried, as someone listening nearby would see it. */
export async function overTheAir(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window as unknown as { __reader: { air: string[] } }).__reader.air.join('\n'),
  );
}

/** Everything that went down the reader's cable, in both directions. */
export async function overTheCable(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window as unknown as { __reader: { cable: string[] } }).__reader.cable.join('\n'),
  );
}

/** The version of the key the stand-in reader holds; 0 when it has none. */
export async function readerKeyVersion(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as { __reader: { epoch: () => number } }).__reader.epoch(),
  );
}
