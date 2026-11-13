import { createCipheriv, createDecipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newReaderKey, readerKeyCheck, readerSessionSecrets } from '@/lib/reader/keys';
import { LineBuffer, fromBase64Url, toBase64Url } from '@/lib/reader/protocol';
import { decryptSecret, encryptSecret } from '@/lib/security/tokens';
import { SecureChannel } from '@/lib/reader/secure-channel';

const DEVICE = 'esp32-a4156cc92df4';
const bytes = (start: number) => Uint8Array.from({ length: 16 }, (_, index) => start + index);

describe('reader keys', () => {
  it('makes a new random key every time', () => {
    const key = newReaderKey();
    expect(key).toHaveLength(32);
    expect(newReaderKey().equals(key)).toBe(false);
  });

  it('fingerprints a key without giving it away', () => {
    const key = newReaderKey();
    const check = readerKeyCheck(key);
    expect(check).toMatch(/^[0-9a-f]{16}$/);
    expect(readerKeyCheck(key)).toBe(check);
    expect(readerKeyCheck(newReaderKey())).not.toBe(check);
    expect(key.toString('hex')).not.toContain(check);
  });

  // The firmware and firmware/kiosk-reader/tools/reader_check.py build the same
  // values. These were worked out separately in Python, so a change to the
  // message layout on one side fails here instead of on a reader.
  it('matches the reference values for the handshake', () => {
    const key = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index));
    const secrets = readerSessionSecrets({
      key,
      deviceId: DEVICE,
      epoch: 1,
      clientNonce: bytes(0x10),
      readerNonce: bytes(0x80),
    });
    expect(readerKeyCheck(key)).toBe('e6d75f18e12a0cf6');
    expect(secrets.clientProof.toString('hex')).toBe(
      'feea264a229230530608d6bb9d517082b56c6d52ec054071b3ce39b3d3ba2eb5',
    );
    expect(secrets.readerProof.toString('hex')).toBe(
      '85ffdc26e69af079b245f45df90847d03e7735b57fafb36a57b8f0e2b827e384',
    );
    expect(secrets.sessionKey.toString('hex')).toBe(
      'ede2f85e3b14209c9f17a14284e315e78bd3caa5c71f67b158e645cd8fa2539c',
    );
  });

  // provision_reader.py seals a key for `reader_keys` the way encryptSecret
  // does. This value was made by that tool, with the key this suite runs under.
  it('opens a key the flashing tool stored', () => {
    const key = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index));
    const stored =
      'v1.BwcHBwcHBwcHBwcH.9kXYuGtsNyUJ8Ym_yEJtSw.9cOyRE7lFWUPq07f9SIhIfvI3XqS6HsbnTy5RotVeAwvNNcYPkS4AC4ecw';
    expect(Buffer.from(decryptSecret(stored), 'base64url').equals(key)).toBe(true);
    const again = encryptSecret(key.toString('base64url'));
    expect(Buffer.from(decryptSecret(again), 'base64url').equals(key)).toBe(true);
  });

  it('ties every value to both nonces', () => {
    const key = newReaderKey();
    const base = { key, deviceId: DEVICE, epoch: 1, clientNonce: bytes(1), readerNonce: bytes(2) };
    const first = readerSessionSecrets(base);
    const replayed = readerSessionSecrets({ ...base, readerNonce: bytes(3) });
    expect(replayed.clientProof.equals(first.clientProof)).toBe(false);
    expect(replayed.sessionKey.equals(first.sessionKey)).toBe(false);
    expect(first.clientProof.equals(first.readerProof)).toBe(false);
    expect(first.sessionKey.equals(first.readerProof)).toBe(false);
  });
});

/** The reader's half of the channel, the way the firmware does it. */
function readerSeal(key: Buffer, counter: bigint, text: string): string {
  const iv = Buffer.alloc(12);
  iv[0] = 2;
  iv.writeBigUInt64BE(counter, 4);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const sealed = Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `#${toBase64Url(Buffer.concat([iv.subarray(4), sealed]))}`;
}

function readerOpen(key: Buffer, line: string): string {
  const frame = Buffer.from(fromBase64Url(line.slice(1)) ?? []);
  const iv = Buffer.alloc(12);
  iv[0] = 1;
  frame.copy(iv, 4, 0, 8);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(frame.subarray(frame.length - 16));
  return Buffer.concat([
    decipher.update(frame.subarray(8, frame.length - 16)),
    decipher.final(),
  ]).toString('utf8');
}

describe('the sealed channel', () => {
  const key = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => 255 - index));

  it('seals lines the reader can open, and opens the reader’s', async () => {
    const channel = await SecureChannel.create(key);
    const command = '{"id":1,"cmd":"nfc.read"}';
    expect(readerOpen(key, await channel.seal(command))).toBe(command);
    expect(readerOpen(key, await channel.seal('{"id":2,"cmd":"info"}'))).toContain('"info"');

    const reply = '{"id":1,"ok":true,"result":{"uri":"https://example.test/c/token"}}';
    expect(await channel.open(readerSeal(key, BigInt(1), reply))).toBe(reply);
  });

  it('never repeats a nonce and never reads a line twice', async () => {
    const channel = await SecureChannel.create(key);
    const first = await channel.seal('{"id":1,"cmd":"ping"}');
    const second = await channel.seal('{"id":1,"cmd":"ping"}');
    expect(second).not.toBe(first);

    const line = readerSeal(key, BigInt(5), '{"id":1,"ok":true}');
    await channel.open(line);
    await expect(channel.open(line)).rejects.toThrow('repeated');
    await expect(channel.open(readerSeal(key, BigInt(4), '{"ok":true}'))).rejects.toThrow();
  });

  it('refuses anything not sealed with this session’s key', async () => {
    const channel = await SecureChannel.create(key);
    const other = Buffer.alloc(32, 7);
    await expect(channel.open(readerSeal(other, BigInt(1), '{"ok":true}'))).rejects.toThrow(
      'could not be verified',
    );
    await expect(channel.open('{"id":1,"ok":true}')).rejects.toThrow('not sealed');

    const line = readerSeal(key, BigInt(1), '{"id":1,"ok":true}');
    const tampered = `${line.slice(0, -2)}${line.endsWith('AA') ? 'BB' : 'AA'}`;
    await expect(channel.open(tampered)).rejects.toThrow();
    // A line the browser sealed is not one the reader could have sent.
    await expect(channel.open(await channel.seal('{"ok":true}'))).rejects.toThrow();
  });
});

describe('reader line framing', () => {
  it('rebuilds lines however they were split', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"id":1,')).toEqual([]);
    expect(buffer.push('"ok":true}\r\n[boot] hi\n{"id"')).toEqual([
      '{"id":1,"ok":true}',
      '[boot] hi',
    ]);
    expect(buffer.push(':2}\n\n')).toEqual(['{"id":2}']);
  });

  it('round-trips bytes through base64url', () => {
    const data = Uint8Array.from([0, 250, 251, 252, 253, 254, 255, 1]);
    expect(toBase64Url(data)).not.toMatch(/[+/=]/);
    expect(fromBase64Url(toBase64Url(data))).toEqual(data);
    expect(fromBase64Url('not base64!')).toBeNull();
  });
});
