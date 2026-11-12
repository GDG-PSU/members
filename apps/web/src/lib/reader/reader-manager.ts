import {
  BluetoothLink,
  type BluetoothDeviceLike,
  type BluetoothLike,
  type OpenReaderSession,
} from '@/lib/reader/bluetooth-link';
import {
  LinkClosedError,
  errorMessage,
  sleep,
  type LinkHooks,
  type ReaderLink,
} from '@/lib/reader/link';
import {
  READER_SERVICE,
  supportsBluetooth,
  type ReaderEvent,
  type ReaderInfo,
  type ReaderResponse,
  type ReaderTransport,
} from '@/lib/reader/protocol';
import { SerialLink, type SerialLike, type SerialPortLike } from '@/lib/reader/serial-link';

export type ReaderPairingGrant =
  | { ok: true; current: true }
  | { ok: true; current: false; key: string; epoch: number; check: string }
  | { ok: false; error: string };

export type ReaderDeps = {
  serial: SerialLike | null;
  bluetooth: BluetoothLike | null;
  /** Asks the server for the key a reader on the cable should hold. */
  pairReader(input: {
    deviceId: string;
    epoch?: number;
    check?: string;
  }): Promise<ReaderPairingGrant>;
  openSession: OpenReaderSession;
  /** How long the link is kept after the last page using it has gone. */
  releaseAfterMs?: number;
  /** How long to keep trying Bluetooth after a link is lost. */
  reconnectForMs?: number;
};

export type ReaderSnapshot = {
  connected: boolean;
  connecting: boolean;
  /** Moving from one link to the other; still counts as connected. */
  switching: boolean;
  transport: ReaderTransport | null;
  info: ReaderInfo | null;
  status: string;
  error: string;
  log: string[];
  serialSupported: boolean;
  bluetoothSupported: boolean;
  /** The organizer chose Bluetooth while a reader is on the cable. */
  bluetoothChosen: boolean;
};

export const EMPTY_READER_SNAPSHOT: ReaderSnapshot = {
  connected: false,
  connecting: false,
  switching: false,
  transport: null,
  info: null,
  status: '',
  error: '',
  log: [],
  serialSupported: true,
  bluetoothSupported: false,
  bluetoothChosen: false,
};

const FRIENDLY: Record<string, string> = {
  not_paired:
    'This reader has not been set up for Bluetooth. Plug it in with a cable once, then try again.',
  auth_failed:
    'The reader did not accept this site. Plug it in with a cable once to set it up again.',
  forbidden: 'Sign in again, then connect the reader.',
};

function friendly(error: unknown): string {
  const message = errorMessage(error);
  return FRIENDLY[message] ?? message;
}

/** Closing the browser's own picker is a choice, not a fault. */
function pickerClosed(error: unknown): boolean {
  return error instanceof Error && (error.name === 'NotFoundError' || error.name === 'AbortError');
}

/**
 * The one connection to a reader that the admin pages share.
 *
 * It can run over the USB cable or over Bluetooth, and the rule between them is
 * simple: the cable wins. If a reader is on the cable, that is the link in use,
 * and any Bluetooth link is let go, whichever reader it was to. Bluetooth is
 * used when there is no cable, or when the organizer asks for it; that choice
 * holds until they switch back, the Bluetooth link fails, or the page reloads.
 *
 * Moving between links is meant to go unnoticed. While one is replacing the
 * other the connection still counts as connected, and a command caught in the
 * middle is sent again on the new link.
 */
export class ReaderManager {
  private usb: SerialLink | null = null;
  private ble: BluetoothLink | null = null;
  /** The reader last used over Bluetooth in this tab; it can reconnect unasked. */
  private bleDevice: BluetoothDeviceLike | null = null;
  private bluetoothChosen = false;
  /** The organizer selected Disconnect, so nothing reconnects by itself. */
  private stopped = false;
  /** Another computer took the reader over its cable. */
  private takenOver = false;

  private opening = 0;
  private bridges = 0;
  private usbOpening = false;
  private reconnecting = false;
  private queue: Promise<void> = Promise.resolve();
  private waiters: (() => void)[] = [];

  private retained = 0;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;

  private status = '';
  private error = '';
  private log: string[] = [];
  private readonly pairChecked = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private snapshot: ReaderSnapshot;

  constructor(private readonly deps: ReaderDeps) {
    this.snapshot = this.buildSnapshot();
    deps.serial?.addEventListener?.('connect', (event) => {
      this.handlePlugged(event.target as SerialPortLike | null);
    });
    deps.serial?.addEventListener?.('disconnect', (event) => {
      const port: unknown = event.target;
      if (this.usb && port === this.usb.port) this.usb.fail('The reader was unplugged.');
    });
  }

  /* ------------------------------ state ----------------------------------- */

  private get active(): ReaderLink | null {
    return this.bluetoothChosen ? this.ble : (this.usb ?? this.ble);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ReaderSnapshot => this.snapshot;

  private buildSnapshot(): ReaderSnapshot {
    const active = this.active;
    const switching = active === null && this.bridges > 0;
    return {
      connected: active !== null || switching,
      connecting: active === null && !switching && this.opening > 0,
      switching,
      transport: active?.transport ?? null,
      info: active?.info ?? null,
      status: this.status,
      error: this.error,
      log: this.log,
      serialSupported: this.deps.serial !== null,
      bluetoothSupported: this.deps.bluetooth !== null,
      bluetoothChosen: this.bluetoothChosen,
    };
  }

  private emit() {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  /** Lets commands that were waiting for a link look again. */
  private wake() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter();
  }

  private addLog(line: string) {
    this.log = [...this.log.slice(-49), line];
  }

  /** Runs link changes one at a time, so two of them never interleave. */
  private run(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task).catch((error: unknown) => {
      console.error('[reader] link change failed', error);
    });
    this.queue = next;
    return next;
  }

  private hooksFor(current: () => ReaderLink | null): LinkHooks {
    return {
      onLog: (line) => {
        this.addLog(line);
        this.emit();
      },
      onStatus: (text) => {
        // A link coming up behind a working one says nothing.
        if (this.active === null) {
          this.status = text;
          this.emit();
        }
      },
      onEvent: (event) => this.handleEvent(event),
      onLost: (reason) => {
        const link = current();
        if (link) this.handleLost(link, reason);
      },
    };
  }

  /* ------------------------------ pages ----------------------------------- */

  /**
   * A page that uses the reader holds it for as long as it is shown. The link
   * outlives a move from one such page to another, and is let go a few seconds
   * after the last one has gone.
   */
  retain(): () => void {
    this.retained += 1;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    if (this.retained === 1 && !this.active && this.opening === 0) {
      this.stopped = false;
      void this.autoStart();
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.retained -= 1;
      if (this.retained > 0) return;
      this.releaseTimer = setTimeout(() => {
        if (this.retained === 0) void this.letGo();
      }, this.deps.releaseAfterMs ?? 4000);
    };
  }

  /** A reader this browser already knows connects without anyone asking. */
  private async autoStart() {
    try {
      const ports = (await this.deps.serial?.getPorts?.()) ?? [];
      if (this.stopped || this.active || this.opening > 0) return;
      const only = ports.length === 1 ? ports[0] : undefined;
      if (only) {
        await this.run(() => this.openUsb(only, false));
        return;
      }
      if (ports.length > 0) return;

      const known = await this.knownBluetoothReaders();
      const reader = known.length === 1 ? known[0] : undefined;
      if (!reader || this.stopped || this.active || this.opening > 0) return;
      this.bleDevice = reader;
      await this.run(async () => {
        if (!this.active && !this.stopped) await this.openBluetooth(reader, true);
      });
    } catch (error) {
      console.debug('[reader] nothing to reconnect to', error);
    }
  }

  private async knownBluetoothReaders(name?: string): Promise<BluetoothDeviceLike[]> {
    try {
      const devices = (await this.deps.bluetooth?.getDevices?.()) ?? [];
      return devices.filter((device) =>
        name ? device.name === name : (device.name ?? '').startsWith('GDG Reader'),
      );
    } catch {
      return [];
    }
  }

  private handlePlugged(port: SerialPortLike | null) {
    if (!port || this.stopped || this.usb || this.usbOpening || this.bluetoothChosen) return;
    // Nothing takes the port while no page is using the reader.
    if (this.retained === 0 && !this.active) return;
    void this.run(async () => {
      if (!this.usb && !this.stopped && !this.bluetoothChosen) await this.openUsb(port, false);
    });
  }

  /* --------------------------- opening links ------------------------------ */

  private async openUsb(port: SerialPortLike, asked: boolean) {
    const bridging = this.active !== null;
    if (bridging) this.bridges += 1;
    this.opening += 1;
    this.usbOpening = true;
    if (asked) this.error = '';
    this.emit();

    const holder: { link: SerialLink | null } = { link: null };
    try {
      const link = await SerialLink.open(
        port,
        this.hooksFor(() => holder.link),
      );
      holder.link = link;
      this.usb = link;
      this.takenOver = false;
      this.bluetoothChosen = false;
      // The cable wins: whatever was on Bluetooth is let go.
      const ble = this.ble;
      this.ble = null;
      await ble?.close();
      if (supportsBluetooth(link.info) && link.info?.mode === 'bluetooth') {
        await link.send('transport.set', { mode: 'auto' }, 3000).catch(() => {});
      }
      this.status = 'Connected.';
      this.error = '';
      void this.ensurePaired(link);
    } catch (error) {
      // A port that appeared by itself and is not a reader is nobody's problem.
      if (asked || !this.active) {
        this.status = '';
        if (asked) this.error = friendly(error);
      }
    } finally {
      this.usbOpening = false;
      this.opening -= 1;
      if (bridging) this.bridges -= 1;
      this.wake();
      this.emit();
    }
  }

  private async openBluetooth(device: BluetoothDeviceLike, quietly: boolean): Promise<boolean> {
    const bridging = this.active !== null;
    if (bridging) this.bridges += 1;
    // A reader tried in passing must not look like a connection in progress.
    if (!quietly) this.opening += 1;
    this.emit();

    const holder: { link: BluetoothLink | null } = { link: null };
    try {
      const link = await BluetoothLink.open(
        device,
        this.deps.openSession,
        quietly
          ? { ...this.hooksFor(() => holder.link), onStatus: () => {} }
          : this.hooksFor(() => holder.link),
        quietly ? 6000 : undefined,
      );
      holder.link = link;
      const previous = this.ble;
      this.ble = link;
      this.bleDevice = device;
      this.takenOver = false;
      await previous?.close();
      this.status = 'Connected.';
      this.error = '';
      return true;
    } catch (error) {
      if (!quietly) {
        this.status = '';
        this.error = friendly(error);
      }
      return false;
    } finally {
      if (!quietly) this.opening -= 1;
      if (bridging) this.bridges -= 1;
      this.wake();
      this.emit();
    }
  }

  /** Once a reader is on the cable, it is given what it needs for Bluetooth later. */
  private async ensurePaired(link: SerialLink) {
    const info = link.info;
    const bluetooth = info?.bluetooth;
    if (!supportsBluetooth(info) || !info?.deviceId || !bluetooth || bluetooth.enabled === false) {
      return;
    }
    const mark = `${info.deviceId}:${bluetooth.epoch ?? 0}:${bluetooth.check ?? ''}`;
    if (bluetooth.paired && this.pairChecked.has(mark)) return;

    try {
      const grant = await this.deps.pairReader({
        deviceId: info.deviceId,
        epoch: bluetooth.epoch,
        check: bluetooth.check,
      });
      if (!grant.ok) {
        this.addLog(`[bluetooth] ${grant.error}`);
        return;
      }
      if (grant.current) {
        this.pairChecked.add(mark);
        return;
      }
      const reply = await link.send('pair.set', { key: grant.key, epoch: grant.epoch }, 4000);
      if (reply.result?.check !== grant.check) {
        throw new Error('The reader did not keep its Bluetooth key.');
      }
      this.pairChecked.add(`${info.deviceId}:${grant.epoch}:${grant.check}`);
      await link.refreshInfo();
      this.addLog('[bluetooth] This reader can now be used over Bluetooth.');
    } catch (error) {
      if (!(error instanceof LinkClosedError)) {
        this.addLog(`[bluetooth] Could not set up Bluetooth: ${errorMessage(error)}`);
      }
    } finally {
      this.emit();
    }
  }

  /* --------------------------- losing links ------------------------------- */

  private handleEvent(event: ReaderEvent) {
    if (event.event !== 'transport') return;
    // The reader is about to drop this Bluetooth link for its cable. If the
    // cable is not ours, another computer has it.
    if (event.to === 'usb' && !this.usb && !this.usbOpening) this.takenOver = true;
    if (event.to === 'off') this.takenOver = true;
  }

  private handleLost(link: ReaderLink, reason: string) {
    const wasActive = this.active === link;
    const lostUsb = link === this.usb;
    const lostBluetooth = link === this.ble;
    if (!lostUsb && !lostBluetooth) return;

    // Decided now, before the commands that just failed look for a new link.
    const backToCable = lostBluetooth && this.usb !== null;
    const retryBluetooth =
      wasActive &&
      !this.stopped &&
      !this.takenOver &&
      this.deps.bluetooth !== null &&
      (lostBluetooth ? !backToCable && this.bleDevice !== null : true);
    const bridging = wasActive && (backToCable || retryBluetooth || this.usbOpening);
    if (bridging) this.bridges += 1;

    void this.run(async () => {
      try {
        if (lostUsb) {
          // A newer link may have taken its place while this waited its turn.
          if (this.usb === link) this.usb = null;
          await link.close();
          // With no cable there is nothing for a Bluetooth choice to override.
          this.bluetoothChosen = false;
          if (!wasActive) return;
          if (retryBluetooth) {
            const name = link.info?.bluetooth?.name;
            if (!this.bleDevice && name) {
              this.bleDevice = (await this.knownBluetoothReaders(name))[0] ?? null;
            }
            if (this.bleDevice) {
              this.reconnectBluetooth('The cable was unplugged. Switching to Bluetooth…');
              return;
            }
          }
          this.status = '';
          this.error = reason;
          return;
        }

        if (this.ble === link) this.ble = null;
        await link.close();
        if (!wasActive || this.active) return;
        if (backToCable && this.usb) {
          const usb = this.usb;
          this.bluetoothChosen = false;
          usb.setQuiet(false);
          await usb.send('transport.set', { mode: 'auto' }, 3000).catch(() => {});
          this.status = 'Bluetooth was lost, so the reader is back on the cable.';
          return;
        }
        if (this.usbOpening || this.usb) return;
        if (retryBluetooth) {
          this.reconnectBluetooth('Bluetooth dropped. Reconnecting…');
          return;
        }
        this.status = '';
        this.error = this.takenOver
          ? 'Another computer is now using this reader over its cable.'
          : reason;
      } finally {
        if (bridging) this.bridges -= 1;
        this.wake();
        this.emit();
      }
    });
  }

  /**
   * Keeps trying the reader last used over Bluetooth. It takes a few seconds to
   * come back: it may be restarting on a charger, and it waits to see whether a
   * computer is on its cable before it offers Bluetooth.
   */
  private reconnectBluetooth(status: string) {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.bridges += 1;
    this.status = status;
    this.emit();

    void (async () => {
      const until = Date.now() + (this.deps.reconnectForMs ?? 25_000);
      let pause = 700;
      try {
        while (!this.active && !this.stopped && !this.takenOver && Date.now() < until) {
          const device = this.bleDevice;
          if (!device) break;
          await this.run(async () => {
            if (!this.active && !this.stopped && !this.usbOpening) {
              await this.openBluetooth(device, true);
            }
          });
          if (this.active) break;
          await sleep(pause);
          pause = Math.min(pause * 1.5, 3000);
        }
      } finally {
        this.reconnecting = false;
        this.bridges -= 1;
        if (!this.active && !this.stopped && this.opening === 0) {
          this.status = '';
          this.error = this.takenOver
            ? 'Another computer is now using this reader over its cable.'
            : 'The reader could not be reached. Plug it in, or select Use Bluetooth to try again.';
        }
        this.wake();
        this.emit();
      }
    })();
  }

  /* --------------------------- what pages call ---------------------------- */

  /** Connect reader: the cable. Asks which port only when it has to. */
  readonly connectUsb = async (): Promise<void> => {
    const serial = this.deps.serial;
    if (!serial) {
      this.error = this.deps.bluetooth
        ? 'This browser cannot use a cable. Select Use Bluetooth instead.'
        : 'This browser cannot talk to the reader. Use Chrome or Edge on a computer.';
      this.emit();
      return;
    }
    this.stopped = false;
    this.error = '';

    if (this.usb) {
      await this.backToCable();
      return;
    }
    let port: SerialPortLike;
    try {
      const known = (await serial.getPorts?.()) ?? [];
      port = known.length === 1 && known[0] ? known[0] : await serial.requestPort();
    } catch (error) {
      if (!pickerClosed(error)) this.error = friendly(error);
      this.emit();
      return;
    }
    this.bluetoothChosen = false;
    await this.run(() => this.openUsb(port, true));
  };

  /** Use Bluetooth: always the organizer's own choice, so it shows the chooser. */
  readonly connectBluetooth = async (): Promise<void> => {
    const bluetooth = this.deps.bluetooth;
    if (!bluetooth) {
      this.error = 'This browser cannot use Bluetooth. Use Chrome or Edge, or plug the reader in.';
      this.emit();
      return;
    }
    this.stopped = false;
    this.error = '';

    // The reader on the cable is told to listen on Bluetooth too, in case it is
    // the one wanted. It appears in the chooser a moment later.
    const usb = this.usb;
    const yielding = usb !== null && supportsBluetooth(usb.info);
    if (usb && yielding) {
      usb.setQuiet(true);
      void usb.send('transport.set', { mode: 'bluetooth' }, 3000).catch(() => {});
    }
    const takeBack = async () => {
      if (!usb || !yielding || this.usb !== usb) return;
      usb.setQuiet(false);
      await usb.send('transport.set', { mode: 'auto' }, 3000).catch(() => {});
    };

    let device: BluetoothDeviceLike;
    try {
      device = await bluetooth.requestDevice({ filters: [{ services: [READER_SERVICE] }] });
    } catch (error) {
      await takeBack();
      if (!pickerClosed(error)) this.error = friendly(error);
      this.emit();
      return;
    }

    await this.run(async () => {
      if (await this.openBluetooth(device, false)) {
        // Only a choice when there is a cable to choose it over.
        this.bluetoothChosen = this.usb !== null;
        this.usb?.setQuiet(true);
      } else {
        await takeBack();
      }
      this.emit();
    });
  };

  /** Switch to USB: ends a Bluetooth choice, or connects the cable if it is not yet. */
  readonly switchToUsb = async (): Promise<void> => {
    if (!this.usb) {
      await this.connectUsb();
      return;
    }
    this.stopped = false;
    this.error = '';
    await this.backToCable();
  };

  private backToCable(): Promise<void> {
    return this.run(async () => {
      const usb = this.usb;
      if (!usb) return;
      try {
        // From here the cable is the link in use, so nothing is left waiting.
        this.bluetoothChosen = false;
        usb.setQuiet(false);
        const ble = this.ble;
        this.ble = null;
        this.status = 'Connected.';
        this.emit();
        if (supportsBluetooth(usb.info)) {
          await usb.send('transport.set', { mode: 'auto' }, 3000).catch(() => {});
        }
        await ble?.close();
      } finally {
        this.wake();
        this.emit();
      }
    });
  }

  readonly disconnect = async (): Promise<void> => {
    this.stopped = true;
    await this.letGo();
    this.status = 'Disconnected.';
    this.emit();
  };

  private letGo(): Promise<void> {
    return this.run(async () => {
      const usb = this.usb;
      const ble = this.ble;
      this.usb = null;
      this.ble = null;
      this.bluetoothChosen = false;
      this.error = '';
      this.status = '';
      this.emit();
      if (usb) {
        if (supportsBluetooth(usb.info) && usb.info?.mode === 'bluetooth') {
          await usb.send('transport.set', { mode: 'auto' }, 1000).catch(() => {});
        }
        // The reader can offer Bluetooth straight away instead of waiting.
        await usb.release();
        await usb.close();
      }
      await ble?.close();
      this.wake();
      this.emit();
    });
  }

  /** Whether this reader may be reached over Bluetooth at all. Cable only. */
  readonly setBluetoothAllowed = async (allowed: boolean): Promise<void> => {
    const usb = this.usb;
    if (!usb || this.active !== usb) return;
    try {
      await usb.send('bluetooth.set', { enabled: allowed }, 4000);
      await usb.refreshInfo();
      if (allowed) await this.ensurePaired(usb);
    } catch (error) {
      this.error = friendly(error);
    }
    this.emit();
  };

  /**
   * Sends one command on whichever link is in use. A command caught by a change
   * of link waits for the new one and is sent again, so a card read survives a
   * cable being plugged in.
   */
  readonly send = async (
    cmd: string,
    extra: Record<string, unknown> = {},
    timeoutMs = 6000,
  ): Promise<ReaderResponse> => {
    for (let attempt = 0; ; attempt += 1) {
      const link = this.active;
      if (!link) {
        if (this.bridges === 0) {
          throw attempt === 0 ? new Error('Connect the reader first.') : new LinkClosedError();
        }
        await new Promise<void>((resolve) => this.waiters.push(resolve));
        continue;
      }
      try {
        return await link.send(cmd, extra, timeoutMs);
      } catch (error) {
        if (!(error instanceof LinkClosedError) || attempt >= 3) throw error;
        if (this.active === link) {
          // The link is going but has not been cleared away yet.
          if (this.bridges === 0) throw error;
          await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
      }
    }
  };
}
