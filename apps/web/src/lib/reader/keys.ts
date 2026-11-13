import { createHmac, randomBytes } from 'node:crypto';

/**
 * The key a card reader holds, and what is worked out from it.
 *
 * Each reader has a random key of its own, put in when it is flashed and stored
 * sealed in `reader_keys` (lib/reader/key-store.ts). The reader obeys only a
 * session opened with that key, on its cable and over Bluetooth alike. The
 * browser does not hold the key for that: the server works out the proofs and
 * hands back only a key for the one session, and only to a signed-in organizer.
 */
const AUTH_CONTEXT = 'gdg-reader-auth-v1';
const CHECK_LABEL = 'gdg-reader-kcv-v1';

export function newReaderKey(): Buffer {
  return randomBytes(32);
}

/** What the reader reports in `info`, so a key can be recognized without being sent. */
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
  /** Seals every line of this session, and no other. */
  sessionKey: Buffer;
};

/**
 * Both nonces are in every value, so a recording of an earlier session proves
 * nothing and opens nothing. The firmware builds the same message in
 * SecureSession::BuildProof.
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
