/**
 * What the browser and the reader agree on, for both links. The firmware's side
 * is firmware/kiosk-reader/src, and docs/usb-api.md describes the whole protocol.
 */

/** The reader's one Bluetooth service: the browser writes to RX and listens on TX. */
export const READER_SERVICE = '7c1f0001-5b0a-4f6e-9a54-6d5b2c8e41a7';
export const READER_RX = '7c1f0002-5b0a-4f6e-9a54-6d5b2c8e41a7';
export const READER_TX = '7c1f0003-5b0a-4f6e-9a54-6d5b2c8e41a7';

/** Firmware from this protocol on knows ping, pairing and Bluetooth. */
export const BLUETOOTH_PROTOCOL = 3;

export const READER_DEVICE_ID = /^esp32-[0-9a-f]{12}$/;
/** 16 bytes as unpadded base64url. */
export const READER_NONCE = /^[A-Za-z0-9_-]{22}$/;
export const READER_KEY_CHECK = /^[0-9a-f]{16}$/;

export type ReaderTransport = 'usb' | 'bluetooth';

export type ReaderBluetoothInfo = {
  name?: string;
  enabled?: boolean;
  paired?: boolean;
  state?: string;
  epoch?: number;
  /** A fingerprint of the pairing key; never the key. */
  check?: string;
};

export type ReaderInfo = {
  protocol?: number;
  firmware?: string;
  deviceId?: string;
  chipId?: string;
  transport?: string;
  mode?: string;
  nfcReady?: boolean;
  nfcFirmware?: number;
  uptimeMs?: number;
  bluetooth?: ReaderBluetoothInfo;
};

export type ReaderResult = ReaderInfo & {
  uri?: string;
  uriLength?: number;
  readBack?: boolean;
  check?: string;
  nonce?: string;
  epoch?: number;
  proof?: string;
};

export type ReaderResponse = {
  id?: number;
  ok: boolean;
  error?: string;
  result?: ReaderResult;
};

/** Something the reader says unprompted, such as having finished starting. */
export type ReaderEvent = {
  event: string;
  to?: string;
  protocol?: number;
  firmware?: string;
  deviceId?: string;
};

export function supportsBluetooth(info: ReaderInfo | null): boolean {
  return (info?.protocol ?? 0) >= BLUETOOTH_PROTOCOL;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Turns a stream of text chunks into whole lines, whatever the chunking. */
export class LineBuffer {
  private pending = '';

  push(chunk: string): string[] {
    this.pending += chunk;
    // The reader's own line limit is about 1 KB; anything longer is noise.
    if (this.pending.length > 16_384) this.pending = '';

    const lines: string[] = [];
    let newline = this.pending.indexOf('\n');
    while (newline >= 0) {
      const line = this.pending.slice(0, newline).replace(/\r$/, '').trim();
      this.pending = this.pending.slice(newline + 1);
      if (line) lines.push(line);
      newline = this.pending.indexOf('\n');
    }
    return lines;
  }

  clear() {
    this.pending = '';
  }
}
