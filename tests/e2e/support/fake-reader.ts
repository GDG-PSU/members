import type { Page } from '@playwright/test';

export const FAKE_READER_ID = 'esp32-0000e2e00001';

/** What a test can do to the stand-in reader from outside the page. */
export type FakeReaderAction =
  /** The cable goes into this computer. */
  | 'plug'
  /** The cable comes out; the reader keeps its power. */
  | 'unplug'
  /** The reader now holds a key the server never gave it. */
  | 'swapKey'
  | 'restoreKey'
  /** The organizer closes the browser's Bluetooth chooser without choosing. */
  | 'closeChooser'
  | 'openChooser';

/**
 * A stand-in for a reader with firmware 2.1.0, whose card contents the test
 * controls through `window.__cardUri`. It has a cable (Web Serial) and a radio
 * (Web Bluetooth), follows the firmware's rule for when the radio is on, and
 * does the real handshake and sealing, so the page's own code is what is tested.
 */
export async function installFakeReader(page: Page) {
  await page.addInitScript((deviceId) => {
    type Command = { id: number; cmd: string; [key: string]: unknown };
    type Reply = Record<string, unknown>;

    const RX = '7c1f0002-5b0a-4f6e-9a54-6d5b2c8e41a7';
    const KEY_ITEM = '__readerKey';
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

    // The pairing key outlives a page load, as it does in the reader's own storage.
    const reader = {
      mode: 'auto' as 'auto' | 'bluetooth',
      cableInUse: false,
      /** Every line that went over the air, as an eavesdropper would see it. */
      air: [] as string[],
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
      handle: async (command: Command, link: 'usb' | 'bluetooth'): Promise<Reply> => {
        const ok = (result?: Reply) => ({
          id: command.id,
          ok: true,
          ...(result ? { result } : {}),
        });
        const fail = (error: string) => ({ id: command.id, ok: false, error });
        const cableOnly = ['pair.set', 'transport.set', 'usb.release', 'bluetooth.set'];
        if (link === 'bluetooth' && cableOnly.includes(command.cmd)) return fail('usb_only');

        if (link === 'usb') {
          reader.cableInUse = command.cmd !== 'usb.release';
          // The cable wins unless the organizer asked for Bluetooth.
          if (reader.cableInUse && reader.mode === 'auto') radio.dropFromReader('usb');
        }
        switch (command.cmd) {
          case 'info':
            return ok({
              protocol: 3,
              firmware: '2.1.0',
              deviceId,
              transport: link === 'usb' ? 'usb-serial' : 'bluetooth',
              mode: reader.mode,
              nfcReady: true,
              bluetooth: {
                name: 'GDG Reader 0001',
                enabled: true,
                paired: reader.key() !== null,
                ...(reader.key() ? { epoch: reader.epoch(), check: await reader.check() } : {}),
              },
            });
          case 'ping':
          case 'usb.release':
            return ok();
          case 'pair.set':
            localStorage.setItem(KEY_ITEM, String(command.key));
            localStorage.setItem(`${KEY_ITEM}Epoch`, String(command.epoch));
            return ok({ check: await reader.check() });
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

    /* ------------------------------ the cable ------------------------------ */

    const serialListeners: Record<string, ((event: Event) => void)[]> = {
      connect: [],
      disconnect: [],
    };
    let plugged = true;
    // A real browser only tells a page about ports it was already allowed to use.
    let permitted = false;

    class FakeSerialPort {
      readable: ReadableStream<Uint8Array> | null = null;
      writable: WritableStream<Uint8Array> | null = null;
      private controller: ReadableStreamDefaultController<Uint8Array> | null = null;

      async open() {
        if (!plugged) throw new Error('The device has been lost.');
        this.readable = new ReadableStream<Uint8Array>({
          start: (controller) => {
            this.controller = controller;
          },
        });
        this.writable = new WritableStream<Uint8Array>({
          write: async (chunk) => {
            for (const line of decoder.decode(chunk).split('\n')) {
              if (!line.trim()) continue;
              const reply = await reader.handle(JSON.parse(line) as Command, 'usb');
              this.controller?.enqueue(encoder.encode(JSON.stringify(reply) + '\n'));
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
    let secure: { key: CryptoKey; sent: bigint } | null = null;
    let nonces: { client: Uint8Array; reader: Uint8Array } | null = null;
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

    const proofFor = async (label: string) => {
      const key = reader.key();
      if (!key || !nonces) return new Uint8Array();
      const transcript = encoder.encode(
        `${label}\0gdg-reader-auth-v1\0${deviceId}\0${reader.epoch()}\0`,
      );
      return hmac(key, concat(transcript, nonces.client, nonces.reader));
    };

    const radio = {
      end: () => {
        if (!connected) return;
        connected = false;
        gatt.connected = false;
        secure = null;
        for (const listener of [...goneListeners]) listener();
      },
      send: async (message: Reply) => {
        let line = JSON.stringify(message);
        if (secure) {
          secure.sent += BigInt(1);
          const iv = nonceFor(2, secure.sent);
          const sealed = new Uint8Array(
            await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, secure.key, encoder.encode(line)),
          );
          line = `#${toBase64Url(concat(iv.subarray(4), sealed))}`;
        }
        reader.air.push(line);
        const bytes = encoder.encode(line + '\n');
        tx.value = new DataView(bytes.buffer);
        for (const listener of [...valueListeners]) listener({ target: tx } as unknown as Event);
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
        if (secure) {
          const frame = fromBase64Url(line.slice(1));
          const counter = new DataView(frame.buffer).getBigUint64(0);
          const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: nonceFor(1, counter) },
            secure.key,
            frame.subarray(8),
          );
          const command = JSON.parse(decoder.decode(plain)) as Command;
          await radio.send(await reader.handle(command, 'bluetooth'));
          return;
        }

        const command = JSON.parse(line) as Command;
        const key = reader.key();
        if (command.cmd === 'auth.begin' && key) {
          nonces = {
            client: fromBase64Url(String(command.nonce)),
            reader: crypto.getRandomValues(new Uint8Array(16)),
          };
          await radio.send({
            id: command.id,
            ok: true,
            result: { deviceId, epoch: reader.epoch(), nonce: toBase64Url(nonces.reader) },
          });
        } else if (command.cmd === 'auth.finish' && key && nonces) {
          if (String(command.proof) !== toBase64Url(await proofFor('client'))) {
            await radio.send({ id: command.id, ok: false, error: 'auth_failed' });
            radio.end();
            return;
          }
          const sessionKey = await crypto.subtle.importKey(
            'raw',
            (await proofFor('session')) as BufferSource,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt'],
          );
          await radio.send({
            id: command.id,
            ok: true,
            result: { proof: toBase64Url(await proofFor('reader')) },
          });
          secure = { key: sessionKey, sent: BigInt(0) };
        } else {
          await radio.send({
            id: command.id,
            ok: false,
            error: key ? 'auth_required' : 'not_paired',
          });
        }
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
        secure = null;
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
      name: 'GDG Reader 0001',
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
