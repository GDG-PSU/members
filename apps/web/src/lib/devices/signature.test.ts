import { describe, expect, it } from 'vitest';
import { deviceSignature, validDeviceSignature } from './signature';

const secret = 'example-device-secret';
const method = 'POST';
const path = '/api/device/v1/heartbeat';
const timestamp = '1700000000';
const nonce = '0123456789abcdef0123456789abcdef';
const body = Buffer.from('{}');
const signature = '838e1991492269623fcafa7283564b2ecaca14a0dad79736a01bbcd8b64b1f52';

describe('device request signing', () => {
  it('matches the protocol test vector', () => {
    expect(deviceSignature(secret, method, path, timestamp, nonce, body)).toBe(signature);
    expect(
      validDeviceSignature(secret, method, path, timestamp, nonce, body, signature, 1700000000),
    ).toBe(true);
  });
  it('rejects modifications, bad signatures, stale timestamps and oversized bodies', () => {
    expect(
      validDeviceSignature(
        secret,
        method,
        path,
        timestamp,
        nonce,
        Buffer.from('{"x":1}'),
        signature,
        1700000000,
      ),
    ).toBe(false);
    expect(
      validDeviceSignature(
        secret,
        method,
        '/api/device/v1/scans',
        timestamp,
        nonce,
        body,
        signature,
        1700000000,
      ),
    ).toBe(false);
    expect(
      validDeviceSignature(
        secret,
        method,
        path,
        timestamp,
        nonce,
        body,
        'f'.repeat(64),
        1700000000,
      ),
    ).toBe(false);
    expect(
      validDeviceSignature(secret, method, path, timestamp, nonce, body, signature, 1700000121),
    ).toBe(false);
    expect(
      validDeviceSignature(
        secret,
        method,
        path,
        timestamp,
        nonce,
        Buffer.alloc(4097),
        signature,
        1700000000,
      ),
    ).toBe(false);
  });
});
