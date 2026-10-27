import { deviceHeartbeatSchema } from '@gdg/contracts';
import { authenticateDevice, currentSessionForDevice } from '@/lib/devices/auth';
import { handleApiError, jsonOk, parseJson } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const id = request.headers.get('x-request-id') ?? 'unknown';
  try {
    const context = await authenticateDevice(request);
    const payload = await parseJson(request, deviceHeartbeatSchema);
    const session = await currentSessionForDevice(context);

    await context.admin
      .from('devices')
      .update({
        last_seen_at: new Date().toISOString(),
        firmware_version: payload.firmwareVersion,
        last_ip_hint: payload.ipHint ?? null,
      })
      .eq('id', context.device.id);

    return jsonOk({
      ok: true,
      mode: context.device.mode,
      lane: context.device.laneLabel,
      session: session ? { id: session.id, name: session.name, eventId: session.event_id } : null,
      serverTime: new Date().toISOString(),
      requestId: context.requestId,
    });
  } catch (error) {
    return handleApiError(error, id);
  }
}
