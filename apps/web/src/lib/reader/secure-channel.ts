import { fromBase64Url, toBase64Url } from '@/lib/reader/protocol';

const COUNTER_BYTES = 8;
const TAG_BYTES = 16;
const TO_READER = 1;
const TO_HOST = 2;

function nonce(direction: number, counter: bigint): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(12);
  bytes[0] = direction;
  new DataView(bytes.buffer).setBigUint64(4, counter);
  return bytes;
}

/**
 * Seals one Bluetooth session. Radio can be heard and written to by anyone
 * nearby, so after the two ends have proved themselves every line is encrypted
 * and authenticated with AES-256-GCM under a key made for this session alone.
 *
 * A sealed line is `#` followed by base64url of
 * `counter (8 bytes, big-endian) || ciphertext || tag (16 bytes)`. The counter
 * only goes up, so a recorded line cannot be played back, and each direction
 * has its own nonce space. The firmware's side is reader_crypto.cpp.
 */
export class SecureChannel {
  private sent = BigInt(0);
  private received = BigInt(0);

  private constructor(private readonly key: CryptoKey) {}

  static async create(sessionKey: Uint8Array): Promise<SecureChannel> {
    if (sessionKey.length !== 32) throw new Error('The session key is the wrong length.');
    // Not extractable: page scripts can use the key but cannot read it back.
    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(sessionKey),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
    return new SecureChannel(key);
  }

  async seal(text: string): Promise<string> {
    this.sent += BigInt(1);
    const iv = nonce(TO_READER, this.sent);
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 },
        this.key,
        new TextEncoder().encode(text),
      ),
    );
    const frame = new Uint8Array(COUNTER_BYTES + sealed.length);
    frame.set(iv.subarray(4), 0);
    frame.set(sealed, COUNTER_BYTES);
    return `#${toBase64Url(frame)}`;
  }

  /** Throws when the line was not sealed by this session's reader, or is a replay. */
  async open(line: string): Promise<string> {
    const frame = line.startsWith('#') ? fromBase64Url(line.slice(1)) : null;
    if (!frame || frame.length < COUNTER_BYTES + TAG_BYTES) {
      throw new Error('The reader sent a line that was not sealed.');
    }
    const counter = new DataView(frame.buffer, frame.byteOffset, COUNTER_BYTES).getBigUint64(0);
    if (counter <= this.received) throw new Error('The reader repeated an old line.');

    let plain: ArrayBuffer;
    try {
      plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce(TO_HOST, counter), tagLength: TAG_BYTES * 8 },
        this.key,
        new Uint8Array(frame.subarray(COUNTER_BYTES)),
      );
    } catch {
      throw new Error('The reader sent a line that could not be verified.');
    }
    this.received = counter;
    return new TextDecoder().decode(plain);
  }
}
