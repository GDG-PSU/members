import { deviceWriteClaimSchema } from '@gdg/contracts';
import { authenticateDevice } from '@/lib/devices/auth';
import { ApiError, handleApiError, jsonOk, parseJson } from '@/lib/api';
import { decryptSecret } from '@/lib/security/tokens';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const id = request.headers.get('x-request-id') ?? 'unknown';
  try {
    const context = await authenticateDevice(request);
    if (context.device.mode !== 'writer') {
      throw new ApiError(409, 'conflict', 'This lane is not in writer mode.', context.requestId);
    }
    const payload = await parseJson(request, deviceWriteClaimSchema);

    const { data, error } = await context.admin.rpc('claim_write_job', {
      p_device_uuid: context.device.id,
      p_firmware_version: payload.firmwareVersion,
    });
    if (error) {
      console.error(`[write-claim:${context.requestId}]`, error.message);
      throw new ApiError(500, 'internal_error', 'Could not claim a write job.', context.requestId);
    }

    const job = Array.isArray(data) ? data[0] : data;
    if (!job) {
      return jsonOk({ job: null, requestId: context.requestId });
    }

    let cardUrl: string;
    try {
      cardUrl = decryptSecret(job.payload_ciphertext as string);
    } catch {
      await context.admin.rpc('complete_write_job', {
        p_job_id: job.job_id,
        p_device_uuid: context.device.id,
        p_status: 'failed',
        p_read_back_matches: false,
        p_failure_code: 'payload_unreadable',
        p_ndef_length: null,
        p_actor: null,
      });
      throw new ApiError(500, 'internal_error', 'Card payload could not be read.', context.requestId);
    }

    return jsonOk({
      job: {
        id: job.job_id,
        cardUrl,
        expiresAt: job.expires_at,
      },
      requestId: context.requestId,
    });
  } catch (error) {
    return handleApiError(error, id);
  }
}
