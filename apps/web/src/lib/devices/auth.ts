import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, requestId } from '@/lib/api';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { decryptSecret } from '@/lib/security/tokens';
import { MAX_DEVICE_BODY_BYTES, validDeviceSignature } from '@/lib/devices/signature';

export interface AuthenticatedDevice {
  id: string;
  deviceId: string;
  laneLabel: string;
  mode: 'kiosk' | 'writer';
  status: 'active' | 'disabled' | 'revoked';
  eventId: string | null;
  sessionId: string | null;
  firmwareVersion: string | null;
}

export interface DeviceRequestContext {
  admin: SupabaseClient;
  device: AuthenticatedDevice;
  requestId: string;
}

const DEVICE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/;

/**
 * Authenticates a device request. Identity is separate from user identity:
 * devices can only reach their own scoped middleware endpoints.
 */
export async function authenticateDevice(request: Request): Promise<DeviceRequestContext> {
  const id = requestId(request);
  const deviceId = request.headers.get('x-device-id')?.trim() ?? '';
  const timestamp = request.headers.get('x-device-timestamp') ?? '';
  const nonce = request.headers.get('x-request-id') ?? '';
  const signature = request.headers.get('x-device-signature') ?? '';
  const url = new URL(request.url);
  const declaredSize = Number(request.headers.get('content-length') ?? '0');

  if (
    !DEVICE_ID_PATTERN.test(deviceId) ||
    request.method !== 'POST' ||
    url.search ||
    (process.env.NODE_ENV === 'production' &&
      request.headers.get('x-forwarded-proto') !== 'https' &&
      url.protocol !== 'https:') ||
    !Number.isFinite(declaredSize) ||
    declaredSize < 0 ||
    declaredSize > MAX_DEVICE_BODY_BYTES
  ) {
    throw new ApiError(401, 'device_unauthorized', 'Invalid device credentials.', id);
  }

  const admin = createSupabaseAdmin();
  const allowed = await admin.rpc('consume_rate_limit', {
    p_bucket: `device-auth:${deviceId}`,
    p_limit: 120,
    p_window_seconds: 60,
  });
  if (allowed.error)
    throw new ApiError(503, 'internal_error', 'Device authorization unavailable.', id);
  if (allowed.data !== true) {
    throw new ApiError(429, 'rate_limited', 'Device rate limit exceeded.', id);
  }

  const { data: device } = await admin
    .from('devices')
    .select(
      'id, device_id, lane_label, secret_ciphertext, status, mode, event_id, session_id, firmware_version',
    )
    .eq('device_id', deviceId)
    .maybeSingle();

  if (!device || !device.secret_ciphertext) {
    throw new ApiError(401, 'device_unauthorized', 'Unknown device.', id);
  }
  if (device.status !== 'active') {
    throw new ApiError(403, 'forbidden', 'This device is disabled.', id);
  }
  const reader = request.clone().body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DEVICE_BODY_BYTES) {
        void reader.cancel();
        throw new ApiError(413, 'bad_request', 'Payload too large.', id);
      }
      chunks.push(value);
    }
  }
  const body = Buffer.concat(chunks, size);
  let verified = false;
  try {
    verified = validDeviceSignature(
      decryptSecret(device.secret_ciphertext as string),
      request.method,
      url.pathname,
      timestamp,
      nonce,
      body,
      signature,
    );
  } catch {
    verified = false;
  }
  if (!verified) throw new ApiError(401, 'device_unauthorized', 'Invalid device credentials.', id);
  const { data: fresh, error: nonceError } = await admin.rpc('consume_device_nonce', {
    p_device_id: device.id,
    p_request_id: nonce,
  });
  if (nonceError || fresh !== true) {
    throw new ApiError(401, 'device_unauthorized', 'Invalid or replayed device request.', id);
  }

  return {
    admin,
    requestId: id,
    device: {
      id: device.id as string,
      deviceId: device.device_id as string,
      laneLabel: device.lane_label as string,
      mode: device.mode as 'kiosk' | 'writer',
      status: device.status as AuthenticatedDevice['status'],
      eventId: (device.event_id as string | null) ?? null,
      sessionId: (device.session_id as string | null) ?? null,
      firmwareVersion: (device.firmware_version as string | null) ?? null,
    },
  };
}

export async function currentSessionForDevice(context: DeviceRequestContext) {
  const { admin, device } = context;
  if (device.sessionId) {
    const { data } = await admin
      .from('event_sessions')
      .select(
        'id, name, event_id, check_in_opens_at, check_in_closes_at, check_out_opens_at, check_out_closes_at, is_enabled',
      )
      .eq('id', device.sessionId)
      .maybeSingle();
    return data;
  }
  if (device.eventId) {
    const { data } = await admin
      .from('event_sessions')
      .select(
        'id, name, event_id, check_in_opens_at, check_in_closes_at, check_out_opens_at, check_out_closes_at, is_enabled',
      )
      .eq('event_id', device.eventId)
      .eq('kind', 'main')
      .maybeSingle();
    return data;
  }
  return null;
}
