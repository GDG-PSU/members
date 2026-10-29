import { deviceScanSchema } from '@gdg/contracts';
import { authenticateDevice, currentSessionForDevice } from '@/lib/devices/auth';
import { ApiError, handleApiError, jsonOk, parseJson } from '@/lib/api';
import { hashToken } from '@/lib/security/tokens';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const id = request.headers.get('x-request-id') ?? 'unknown';
  try {
    const context = await authenticateDevice(request);
    if (context.device.mode !== 'kiosk') {
      throw new ApiError(
        409,
        'conflict',
        'This lane is in writer mode; attendance is paused.',
        context.requestId,
      );
    }

    const payload = await parseJson(request, deviceScanSchema);
    const session = await currentSessionForDevice(context);
    if (!session || !session.is_enabled) {
      throw new ApiError(
        409,
        'conflict',
        'No active session is assigned to this lane.',
        context.requestId,
      );
    }

    const now = Date.now();
    if (
      now < Date.parse(session.check_in_opens_at) ||
      now > Date.parse(session.check_out_closes_at)
    ) {
      throw new ApiError(
        409,
        'conflict',
        'Outside the attendance window for this session.',
        context.requestId,
      );
    }

    const allowed = await context.admin.rpc('consume_rate_limit', {
      p_bucket: `device-scan:${context.device.deviceId}`,
      p_limit: 40,
      p_window_seconds: 60,
    });
    if (allowed.data === false) {
      throw new ApiError(429, 'rate_limited', 'Too many scans; slow down.', context.requestId);
    }

    const tokenHash = hashToken(payload.cardToken);
    const { data: card } = await context.admin
      .from('card_credentials')
      .select('id, member_id, members!inner(status, member_profiles!inner(profile_slug))')
      .eq('token_hash', tokenHash)
      .eq('status', 'active')
      .maybeSingle();

    const member = Array.isArray(card?.members) ? card?.members[0] : card?.members;
    if (!card || !member || member.status !== 'active') {
      throw new ApiError(404, 'not_found', 'Unknown or inactive card.', context.requestId);
    }

    const { data: attendance } = await context.admin
      .from('attendance_records')
      .select('id, checked_out_at')
      .eq('member_id', card.member_id as string)
      .eq('session_id', session.id as string)
      .maybeSingle();

    if (attendance?.checked_out_at) {
      throw new ApiError(
        409,
        'conflict',
        'Attendance is already complete for this session.',
        context.requestId,
      );
    }

    const action = attendance ? 'check_out' : 'check_in';

    const { data: scan, error } = await context.admin
      .from('device_scans')
      .insert({
        device_id: context.device.id,
        member_id: card.member_id,
        card_id: card.id,
        session_id: session.id,
        action,
        status: 'pending',
        idempotency_key: payload.idempotencyKey,
        metadata: { firmware: payload.firmwareVersion, scannedAt: payload.scannedAt ?? null },
      })
      .select('id, status, expires_at, action')
      .single();

    if (error) {
      if (error.code === '23505') {
        const { data: existing } = await context.admin
          .from('device_scans')
          .select('id, status, expires_at, action')
          .eq('device_id', context.device.id)
          .eq('idempotency_key', payload.idempotencyKey)
          .maybeSingle();
        if (existing) {
          return jsonOk({
            scanId: existing.id,
            status: existing.status,
            action: existing.action,
            expiresAt: existing.expires_at,
          });
        }
      }
      console.error(`[device-scan:${context.requestId}]`, error.message);
      throw new ApiError(500, 'internal_error', 'Could not queue the scan.', context.requestId);
    }

    return jsonOk({
      scanId: scan.id,
      status: scan.status,
      action: scan.action,
      expiresAt: scan.expires_at,
      requestId: context.requestId,
    });
  } catch (error) {
    return handleApiError(error, id);
  }
}
