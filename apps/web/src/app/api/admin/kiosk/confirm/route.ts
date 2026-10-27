import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { getApiViewer } from '@/lib/auth/api-guard';
import { handleApiError, jsonError, jsonOk, parseJson, requestId } from '@/lib/api';
import { scanConfirmSchema } from '@gdg/contracts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const id = requestId(request);
  try {
    const viewer = await getApiViewer();
    if (!viewer) return jsonError(401, 'unauthorized', 'Sign in as an organizer.', id);
    if (!viewer.isAdmin) return jsonError(403, 'forbidden', 'Organizer access required.', id);

    const payload = await parseJson(request, scanConfirmSchema);
    const admin = createSupabaseAdmin();

    const allowed = await admin.rpc('consume_rate_limit', {
      p_bucket: `kiosk-confirm:${viewer.user.id}`,
      p_limit: 60,
      p_window_seconds: 60,
    });
    if (allowed.data === false) {
      return jsonError(429, 'rate_limited', 'Slow down and try again.', id);
    }

    const { data, error } = await admin.rpc('confirm_scan', {
      p_scan_id: payload.scanId,
      p_action: payload.action,
      p_actor: viewer.user.id,
      p_reason: payload.reason ?? null,
      p_request_id: id,
    });
    if (error) throw new Error(error.message);

    return jsonOk({ ok: true, attendanceId: data ?? null, requestId: id });
  } catch (error) {
    return handleApiError(error, id);
  }
}
