import { createHash, createHmac, hkdfSync } from 'node:crypto';
import { getEnv } from '@/lib/env';

/**
 * Bluetooth pairing keys for the NFC readers.
 *
 * A reader's key is derived from a server secret and the reader's ID, so there
 * is nothing to store and nothing to look up. The key reaches the reader once,
 * over the cable. After that the browser never holds it: when a Bluetooth
 * session opens, the server works out the proofs and hands back only a key for
 * that one session, and only to a signed-in organizer.
 *
 * Raise READER_KEY_EPOCH to retire every reader's key at once, for instance
 * after a reader is lost. Each reader then pairs again the next time it is
 * plugged in. Changing CARD_WRITE_ENCRYPTION_KEY does the same.
 */
export const READER_KEY_EPOCH = 1;

const AUTH_CONTEXT = 'gdg-reader-auth-v1';
const CHECK_LABEL = 'gdg-reader-kcv-v1';

function pairingSecret(): Buffer {
  // The same reading of the variable as lib/security/tokens.ts, then HKDF with
  // its own label so this key is independent of the one that seals card tokens.
  const raw = getEnv().CARD_WRITE_ENCRYPTION_KEY;
  const decoded = Buffer.from(raw, 'base64');
  const material =
    decoded.length === 32 ? decoded : createHash('sha256').update(raw, 'utf8').digest();
  return Buffer.from(hkdfSync('sha256', material, Buffer.alloc(0), 'gdg-reader-pairing-v1', 32));
}

export function deriveReaderKey(deviceId: string, epoch: number = READER_KEY_EPOCH): Buffer {
  return createHmac('sha256', pairingSecret())
    .update(`reader-key\0${deviceId}\0${epoch}`, 'utf8')
    .digest();
}

/** What the reader reports in `info`, so a stale key can be spotted without sending one. */
export function readerKeyCheck(key: Buffer): string {
  return createHmac('sha256', key)
    .update(CHECK_LABEL, 'utf8')
    .digest()
    .subarray(0, 8)
    .toString('hex');
}

export type ReaderSessionSecrets = {
  /** Sent to the reader: proves this side holds the key. */
  clientProof: Buffer;
  /** What a genuine reader answers with. */
  readerProof: Buffer;
  /** Seals every frame of this session, and no other. */
  sessionKey: Buffer;
};

/**
 * Both nonces are in every value, so a recording of an earlier session proves
 * nothing and opens nothing. The firmware builds the same message in
 * BleLink::BuildProof.
 */
export function readerSessionSecrets(input: {
  key: Buffer;
  deviceId: string;
  epoch: number;
  clientNonce: Uint8Array;
  readerNonce: Uint8Array;
}): ReaderSessionSecrets {
  const transcript = Buffer.concat([
    Buffer.from(`${AUTH_CONTEXT}\0${input.deviceId}\0${input.epoch}\0`, 'utf8'),
    input.clientNonce,
    input.readerNonce,
  ]);
  const sign = (label: string) =>
    createHmac('sha256', input.key)
      .update(Buffer.concat([Buffer.from(`${label}\0`, 'utf8'), transcript]))
      .digest();
  return {
    clientProof: sign('client'),
    readerProof: sign('reader'),
    sessionKey: sign('session'),
  };
}
