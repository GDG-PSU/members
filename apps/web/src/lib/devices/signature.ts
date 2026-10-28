import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_DEVICE_BODY_BYTES = 4096;
export const MAX_DEVICE_CLOCK_SKEW_SECONDS = 120;

export function deviceSignature(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: Uint8Array,
): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const canonical = [method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

export function validDeviceSignature(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: Uint8Array,
  signature: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(nowSeconds - Number(timestamp)) > MAX_DEVICE_CLOCK_SKEW_SECONDS ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    body.byteLength > MAX_DEVICE_BODY_BYTES
  )
    return false;
  const expected = Buffer.from(
    deviceSignature(secret, method, path, timestamp, nonce, body),
    'hex',
  );
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
