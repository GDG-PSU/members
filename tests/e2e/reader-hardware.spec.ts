import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { expect, test, type Page } from '@playwright/test';
import { baseUrl, hasSupabaseAdminCredentials, loadTestEnv, siteOrigin } from './support/env';
import { createDisposableAdmin, deleteAdminFixture, serviceClient } from './support/supabase';
import { totp } from './support/totp';

loadTestEnv();

/**
 * The real pages, a real reader, and real radio.
 *
 *   READER_PORT=COM3 pnpm e2e tests/e2e/reader-hardware.spec.ts --project=desktop-chromium
 *
 * It needs a reader with firmware 2.2 on that port, a Bluetooth adapter, a
 * disposable Supabase stack, and Python with pyserial (READER_PYTHON, default
 * `python`). Close any other tab that is connected to the reader.
 *
 * Give the reader its key first, the way it is done after flashing, with the
 * same stack in the environment:
 *
 *   python firmware/kiosk-reader/tools/provision_reader.py --port COM3
 *
 * That is part of what is tested: the pages have to open a session with a key
 * the tool stored. Afterwards the reader belongs to the test stack; clear it
 * with `provision_reader.py --port COM3 --clear` before the stack is stopped.
 *
 * Leave the reader empty, or put a spare writable card on it and set
 * READER_CARD=1. The card is then written by the real one-button writer, once
 * over the cable and once over Bluetooth, and read back each time. It is left
 * holding a link to a test stack, so do not use a member's card.
 *
 * Two things are stood in for. The browser's serial port picker cannot be
 * automated, so `navigator.serial` is a port that relays to the real one; the
 * reader stays plugged in throughout, and "pulling the cable" closes that port,
 * which is all a reader can tell of a cable anyway. The Bluetooth side is the
 * browser's own Web Bluetooth, with its chooser answered over the DevTools
 * protocol, so it runs with a window.
 */
const port = process.env.READER_PORT;

test.use({ headless: false });

test.describe('a physical reader, over its cable and over Bluetooth', () => {
  test.skip(!port, 'Needs a reader: set READER_PORT, for example COM3.');
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  const stamp = `${Date.now()}-${randomBytes(3).toString('hex')}`;
  const admin = { email: `hw-admin-${stamp}@example.com`, password: `Hw-Admin-${stamp}-1a` };
  const withCard = process.env.READER_CARD === '1';
  // The card is written for the organizer running the test, under a name no
  // other run shares.
  const holderName = `Reader Test ${stamp.slice(-6)}`;
  let adminId = '';
  let holderId = '';
  let origin = '';
  let bridge: ChildProcessWithoutNullStreams | null = null;
  let page: Page;
  let readerName = '';
  const waiting = new Map<string, () => void>();

  const tell = (message: Record<string, unknown>) => {
    bridge?.stdin.write(JSON.stringify(message) + '\n');
  };
  const answered = (key: 'opened' | 'closed') =>
    new Promise<void>((resolve) => {
      waiting.set(key, resolve);
    });
  const reader = (action: 'plug' | 'unplug') =>
    page.evaluate((name) => {
      (window as unknown as { __bridge: Record<string, () => void> }).__bridge[name]?.();
    }, action);
  const badge = (link: 'USB' | 'Bluetooth') => page.getByLabel(`Connected by ${link}`);
  const alerts = () => page.locator('main').getByRole('alert');
  // Connected and settled. After a write the page asks for the card to be lifted,
  // which is still connected.
  const steady = () => page.getByText(/^(Reader connected|Lift the card off the reader)$/);
  const timed = async (what: string, work: () => Promise<void>) => {
    const started = Date.now();
    await work();
    console.log(`  ${what}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  };

  test.beforeAll(async ({ browser }, testInfo) => {
    test.skip(!hasSupabaseAdminCredentials(), 'Needs a disposable Supabase stack.');
    test.skip(testInfo.project.name !== 'desktop-chromium', 'The reader is tested once.');
    origin = new URL(baseUrl()).origin;
    test.skip(origin !== siteOrigin(), `Links are issued for ${siteOrigin()}.`);

    const client = serviceClient();
    const created = await createDisposableAdmin(client, admin);
    adminId = created.user.id;
    const { data: holder } = await client
      .from('members')
      .select('id')
      .eq('auth_user_id', adminId)
      .single();
    holderId = (holder?.id as string | undefined) ?? '';
    await client
      .from('member_profiles')
      .update({ display_name: holderName })
      .eq('member_id', holderId);

    bridge = spawn(process.env.READER_PYTHON ?? 'python', [
      path.resolve('tests/e2e/support/serial_bridge.py'),
      port ?? '',
    ]);
    bridge.stderr.on('data', (chunk: Buffer) => console.error(`[bridge] ${chunk.toString()}`));

    const context = await browser.newContext({ baseURL: origin });
    page = await context.newPage();
    createInterface({ input: bridge.stdout }).on('line', (line) => {
      const message = JSON.parse(line) as { data?: string; opened?: boolean; closed?: boolean };
      if (message.opened) waiting.get('opened')?.();
      if (message.closed) waiting.get('closed')?.();
      if (message.data !== undefined) {
        void page
          .evaluate((chunk) => {
            (window as unknown as { __bridge: { push(chunk: string): void } }).__bridge.push(chunk);
          }, message.data)
          .catch(() => {});
      }
    });
    await page.exposeFunction('__bridgeOpen', async () => {
      const opened = answered('opened');
      tell({ op: 'open' });
      await opened;
    });
    await page.exposeFunction('__bridgeWrite', (data: string) => tell({ op: 'write', data }));
    await page.exposeFunction('__bridgeClose', async () => {
      const closed = answered('closed');
      tell({ op: 'close' });
      await closed;
    });

    await page.addInitScript(() => {
      const bindings = window as unknown as {
        __bridgeOpen(): Promise<void>;
        __bridgeWrite(data: string): Promise<void>;
        __bridgeClose(): Promise<void>;
        __bridge: Record<string, unknown>;
      };
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const listeners: Record<string, ((event: Event) => void)[]> = { connect: [], disconnect: [] };
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      let plugged = true;
      let permitted = false;

      const relayed = {
        readable: null as ReadableStream<Uint8Array> | null,
        writable: null as WritableStream<Uint8Array> | null,
        async open() {
          if (!plugged) throw new Error('The device has been lost.');
          this.readable = new ReadableStream<Uint8Array>({
            start: (created) => {
              controller = created;
            },
          });
          this.writable = new WritableStream<Uint8Array>({
            write: (chunk) => bindings.__bridgeWrite(decoder.decode(chunk)),
          });
          await bindings.__bridgeOpen();
        },
        async close() {
          controller = null;
          await bindings.__bridgeClose();
        },
      };
      Object.defineProperty(navigator, 'serial', {
        configurable: true,
        value: {
          requestPort: async () => {
            permitted = true;
            return relayed;
          },
          getPorts: async () => (plugged && permitted ? [relayed] : []),
          addEventListener: (type: string, listener: (event: Event) => void) => {
            listeners[type]?.push(listener);
          },
        },
      });
      bindings.__bridge = {
        push: (chunk: string) => {
          try {
            controller?.enqueue(encoder.encode(chunk));
          } catch {
            // The port was closed while the reader was still talking.
          }
        },
        plug: () => {
          plugged = true;
          for (const listener of listeners.connect ?? []) {
            listener({ target: relayed } as unknown as Event);
          }
        },
        unplug: () => {
          plugged = false;
          try {
            controller?.error(new Error('The device has been lost.'));
          } catch {
            // Already closed.
          }
          controller = null;
          for (const listener of listeners.disconnect ?? []) {
            listener({ target: relayed } as unknown as Event);
          }
        },
      };
    });

    // The browser's own Bluetooth chooser, answered the way an organizer would.
    const devtools = await context.newCDPSession(page);
    await devtools.send('DeviceAccess.enable');
    devtools.on('DeviceAccess.deviceRequestPrompted', (prompt) => {
      const found = prompt.devices.find((device) => device.name === readerName);
      if (found) {
        void devtools
          .send('DeviceAccess.selectPrompt', { id: prompt.id, deviceId: found.id })
          .catch(() => {});
      }
    });

    await page.goto('/login');
    await page.getByLabel('Email').fill(admin.email);
    await page.getByLabel('Password').fill(admin.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin-mfa/, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Set up authenticator' }).click();
    const secret = ((await page.locator('code').textContent()) ?? '').trim().toUpperCase();
    await page.getByLabel('Six-digit code').fill(totp(secret));
    await page.getByRole('button', { name: 'Verify and open admin' }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
  });

  test.afterAll(async () => {
    await page?.context().close();
    bridge?.kill();
    if (adminId) await deleteAdminFixture(serviceClient(), adminId).catch(() => {});
  });

  test('opens only for a signed-in organizer, on its cable and over Bluetooth', async () => {
    const storedVersions = async (deviceId: string) => {
      const { data } = await serviceClient()
        .from('reader_keys')
        .select('version')
        .eq('device_id', deviceId)
        .order('version');
      return (data ?? []).map((row) => row.version as number);
    };
    const rotateKey = async () => {
      await page.getByRole('button', { name: 'Rotate key' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Rotate key' }).click();
      await expect(
        page.getByText('This reader has a new key. The old one no longer works.'),
      ).toBeVisible({ timeout: 20_000 });
    };

    await page.goto('/admin/cards');
    await timed('connect by cable', async () => {
      await page.getByRole('button', { name: 'Connect reader' }).click();
      await expect(badge('USB')).toBeVisible({ timeout: 30_000 });
    });
    await page.getByText('Reader tools').click();
    const identity = page.getByText(/esp32-[0-9a-f]{12} · firmware 2\.2\.\d+/);
    await expect(identity).toBeVisible();
    const deviceId = /esp32-[0-9a-f]{12}/.exec((await identity.textContent()) ?? '')?.[0] ?? '';

    // The session was opened with the key the flashing tool stored, by the real
    // server action, over the real cable. The page had no key to give.
    const ready = page.getByText(/Bluetooth is ready\. .* it appears as GDG Reader [0-9A-F]{4}\./);
    await expect(ready).toBeVisible({ timeout: 20_000 });
    readerName = /GDG Reader [0-9A-F]{4}/.exec((await ready.textContent()) ?? '')?.[0] ?? '';
    console.log(`  reader: ${readerName}`);
    const { data: pairings } = await serviceClient()
      .from('audit_log')
      .select('target_id')
      .eq('action', 'reader.paired')
      .eq('actor_auth_id', adminId);
    expect(pairings).toHaveLength(0);
    const before = await storedVersions(deviceId);
    expect(before).toHaveLength(1);

    // Rotate key, in the real reader's storage: the old key is gone from both ends.
    await timed('rotate the key over the cable', rotateKey);
    const afterCable = (before[0] ?? 0) + 1;
    await expect.poll(() => storedVersions(deviceId)).toEqual([afterCable]);

    // One button prepares the card, writes it, reads it back and switches it on.
    const writeCard = async () => {
      await page.locator('#card-holder-search').fill(holderName);
      await page
        .getByRole('list', { name: 'People found' })
        .getByRole('button', { name: holderName })
        .click();
      await page.getByRole('button', { name: 'Write card' }).click();
      await expect(page.getByText(`${holderName}'s card is written and working.`)).toBeVisible({
        timeout: 45_000,
      });
    };
    const cardLink = new RegExp(
      `^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/c/[A-Za-z0-9_-]{43}$`,
    );
    const readCard = async () => {
      await page.getByRole('button', { name: 'Read a card' }).click();
      const shown = page.locator('p.break-all');
      await expect(shown).toHaveText(cardLink, { timeout: 30_000 });
      return (await shown.textContent()) ?? '';
    };
    let writtenByCable = '';
    if (withCard) {
      await timed('write a card over the cable', writeCard);
      writtenByCable = await readCard();
    }

    // Letting go of the cable puts the reader on the air.
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await reader('unplug');
    await timed('connect by Bluetooth', async () => {
      await page.getByRole('button', { name: 'Use Bluetooth' }).click();
      await expect(badge('Bluetooth')).toBeVisible({ timeout: 45_000 });
    });
    await expect(page.getByText('In use over Bluetooth.')).toBeVisible();
    await expect(alerts()).toHaveCount(0);

    // The key can be changed over the air too, inside the sealed session.
    await timed('rotate the key over Bluetooth', rotateKey);
    await expect.poll(() => storedVersions(deviceId)).toEqual([afterCable + 1]);

    // Commands go over the air, sealed, for as long as the page keeps asking.
    if (withCard) {
      // What the cable wrote, the air reads.
      await timed('read the card over Bluetooth', async () => {
        expect(await readCard()).toBe(writtenByCable);
      });

      // A written card has to leave the reader before the page writes the next
      // one, and nobody is here to lift it. A fresh page has no such memory.
      await page.reload();
      await timed('connect by Bluetooth again on a fresh page', async () => {
        await page.getByRole('button', { name: 'Use Bluetooth' }).click();
        await expect(badge('Bluetooth')).toBeVisible({ timeout: 45_000 });
      });
      await page.getByText('Reader tools').click();
      await timed('write a card over Bluetooth', writeCard);
      const writtenByBluetooth = await readCard();
      expect(writtenByBluetooth).not.toBe(writtenByCable);
      // The new card is the one that works now, and the one before it is not.
      const { data: cards } = await serviceClient()
        .from('card_credentials')
        .select('status')
        .eq('member_id', holderId);
      expect(cards?.map((card) => card.status as string).sort()).toEqual(['active', 'replaced']);
    } else {
      await page.getByRole('button', { name: 'Read a card' }).click();
      // With nothing on it the reader keeps answering "no card" for as long as
      // the page asks. With its NFC module unplugged, or something on it that
      // is not a card it can read, it says so, once, over the air.
      await page.waitForTimeout(4000);
      await expect(alerts()).toHaveCount(0);
      const cancel = page.getByRole('button', { name: 'Cancel' });
      if (await cancel.isVisible()) {
        await cancel.click();
        console.log('  polled for a card over Bluetooth for 4 s');
      } else {
        const said = page.getByText(
          /^(The NFC module is not responding.|This card type is not supported.|This card has no readable URL on it.|The card could not be read.)/,
        );
        await expect(said).toBeVisible();
        console.log(`  the reader answered over Bluetooth: ${await said.textContent()}`);
      }
    }
    await expect(badge('Bluetooth')).toBeVisible();

    // Plugging in moves the page to the cable, without a click and without an error.
    await timed('move to the cable when plugged in', async () => {
      await reader('plug');
      await expect(badge('USB')).toBeVisible({ timeout: 30_000 });
    });
    await expect(steady()).toBeVisible();
    await expect(alerts()).toHaveCount(0);

    // The organizer can ask for Bluetooth with the cable in, and go back.
    await timed('switch to Bluetooth with the cable in', async () => {
      await page.getByRole('button', { name: 'Switch to Bluetooth' }).click();
      await expect(badge('Bluetooth')).toBeVisible({ timeout: 45_000 });
    });
    await page.waitForTimeout(5000);
    await expect(badge('Bluetooth'), 'the cable does not take the choice back').toBeVisible();
    await timed('switch back to the cable', async () => {
      await page.getByRole('button', { name: 'Switch to USB' }).click();
      await expect(badge('USB')).toBeVisible({ timeout: 20_000 });
    });
    await expect(alerts()).toHaveCount(0);

    // With the cable gone, the page finds the reader over Bluetooth again by itself.
    await timed('fall back to Bluetooth when the cable goes', async () => {
      await reader('unplug');
      await expect(badge('Bluetooth')).toBeVisible({ timeout: 45_000 });
    });
    await expect(steady()).toBeVisible();
    await expect(alerts()).toHaveCount(0);

    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByText('Reader not connected')).toBeVisible();
  });
});
