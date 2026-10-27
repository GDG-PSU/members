import { deviceWriteCompleteSchema } from '@gdg/contracts';
import { authenticateDevice } from '@/lib/devices/auth';
import { ApiError, handleApiError, jsonOk, parseJson } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const id = request.headers.get('x-request-id') ?? 'unknown';
  try {
    const context = await authenticateDevice(request);
    if (context.device.mode !== 'writer') {
      throw new ApiError(409, 'conflict', 'This lane is not in writer mode.', context.requestId);
    }
    const payload = await parseJson(request, deviceWriteCompleteSchema);

    const { error } = await context.admin.rpc('complete_write_job', {
      p_job_id: payload.jobId,
      p_device_uuid: context.device.id,
      p_status: payload.status,
      p_read_back_matches: payload.readBackMatches ?? false,
      p_failure_code: payload.failureCode ?? null,
      p_ndef_length: payload.ndefLength ?? null,
      p_actor: null,
    });
    if (error) {
      throw new Error(error.message);
    }

    if (payload.status === 'written') {
      const { data: job } = await context.admin
        .from('card_write_jobs')
        .select('member_id')
        .eq('id', payload.jobId)
        .maybeSingle();
      await context.admin.rpc('log_audit', {
        p_actor: null,
        p_action: 'card.written_by_device',
        p_target_type: 'member',
        p_target_id: job?.member_id ?? null,
        p_reason: null,
        p_before: null,
        p_after: { job_id: payload.jobId, device: context.device.deviceId, read_back: true },
        p_request_id: context.requestId,
      });
    }

    return jsonOk({ status: payload.status, requestId: context.requestId });
  } catch (error) {
    return handleApiError(error, id);
  }
}
