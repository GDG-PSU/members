import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { hasSupabaseAdminCredentials, loadTestEnv } from './support/env';
import { serviceClient } from './support/supabase';

loadTestEnv();

test('device signatures are required and nonces cannot be replayed', async ({ request }) => {
  test.skip(
    !hasSupabaseAdminCredentials() || !process.env.CARD_WRITE_ENCRYPTION_KEY,
    'Local Supabase and card encryption key are required.',
  );
  const supabase = serviceClient();
  const secret = randomBytes(32).toString('base64url');
  const deviceId = `test-${randomBytes(6).toString('hex')}`;
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(process.env.CARD_WRITE_ENCRYPTION_KEY!, 'base64'),
    iv,
  );
  const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);
  const ciphertext = [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
  const { data: device, error } = await supabase
    .from('devices')
    .insert({
      device_id: deviceId,
      lane_label: 'Test lane',
      secret_hash: createHash('sha256').update(secret).digest('hex'),
      secret_ciphertext: ciphertext,
    })
    .select('id')
    .single();
  expect(error).toBeNull();
  const path = '/api/device/v1/heartbeat';
  const body = JSON.stringify({ firmwareVersion: 'test', mode: 'kiosk' });
  const signed = (timestamp: string, nonce: string, raw = body) => {
    const hash = createHash('sha256').update(raw).digest('hex');
    return {
      'content-type': 'application/json',
      'x-device-id': deviceId,
      'x-device-timestamp': timestamp,
      'x-request-id': nonce,
      'x-device-signature': createHmac('sha256', secret)
        .update(['POST', path, timestamp, nonce, hash].join('\n'))
        .digest('hex'),
    };
  };
  try {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    const headers = signed(timestamp, nonce);
    expect((await request.post(path, { headers, data: body })).status()).toBe(200);
    expect((await request.post(path, { headers, data: body })).status()).toBe(401);
    expect(
      (
        await request.post(path, {
          headers: signed(String(Number(timestamp) - 121), randomBytes(16).toString('hex')),
          data: body,
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await request.post(path, {
          headers: signed(timestamp, randomBytes(16).toString('hex'), '{}'),
          data: body,
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await request.post(path, {
          headers: { 'x-device-id': deviceId, 'x-device-secret': secret },
          data: body,
        })
      ).status(),
    ).toBe(401);
    await supabase.from('devices').update({ status: 'revoked' }).eq('id', device!.id);
    expect(
      (
        await request.post(path, {
          headers: signed(timestamp, randomBytes(16).toString('hex')),
          data: body,
        })
      ).status(),
    ).toBe(403);
  } finally {
    await supabase.from('devices').delete().eq('id', device!.id);
  }
});
