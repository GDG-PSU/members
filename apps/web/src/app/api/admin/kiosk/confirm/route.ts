import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { getApiViewer } from '@/lib/auth/api-guard';
import { handleApiError, jsonError, jsonOk, parseJson, requestId } from '@/lib/api';
import { scanConfirmSchema } from '@gdg/contracts';
import { photoChangedWithin } from '@/lib/profile/identity';
import { SITE_URL } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const id = requestId(request);
  try {
    const viewer = await getApiViewer();
    if (!viewer) return jsonError(401, 'unauthorized', 'Sign in as an organizer.', id);
    if (!viewer.isAdmin) return jsonError(403, 'forbidden', 'Organizer access required.', id);
    if (request.headers.get('origin') !== new URL(SITE_URL).origin) {
      return jsonError(403, 'forbidden', 'Invalid request origin.', id);
    }

    const payload = await parseJson(request, scanConfirmSchema);
    const admin = createSupabaseAdmin();

    // A fresh photo is an unverified identity claim. The kiosk UI asks for a
    // PSU ID; the server must enforce the same rule so the API cannot skip it.
    let photoChangedRecently = false;
    if (payload.action !== 'reject') {
      const { data: scan } = await admin
        .from('device_scans')
        .select('member_id')
        .eq('id', payload.scanId)
        .maybeSingle();
      if (scan?.member_id) {
        const { data: profile } = await admin
          .from('member_profiles')
          .select('photo_changed_at')
          .eq('member_id', scan.member_id as string)
          .maybeSingle();
        photoChangedRecently = photoChangedWithin(profile?.photo_changed_at as string | undefined);
      }
      if (photoChangedRecently && payload.identityCheck !== true) {
        return jsonError(
          400,
          'bad_request',
          'This member changed their photo in the last 48 hours. Check their PSU ID before confirming.',
          id,
        );
      }
    }
    const identityChecked = payload.action !== 'reject' && payload.identityCheck === true;

    const allowed = await admin.rpc('consume_rate_limit', {
      p_bucket: `kiosk-confirm:${viewer.user.id}`,
      p_limit: 60,
      p_window_seconds: 60,
    });
    if (allowed.data === false) {
      return jsonError(429, 'rate_limited', 'Slow down and try again.', id);
    }

    const reason = identityChecked
      ? [payload.reason, 'PSU ID checked (photo updated within 48h)'].filter(Boolean).join(' · ')
      : (payload.reason ?? null);

    const { data, error } = await admin.rpc('confirm_scan', {
      p_scan_id: payload.scanId,
      p_action: payload.action,
      p_actor: viewer.user.id,
      p_reason: reason,
      p_request_id: id,
    });
    if (error) throw new Error(error.message);

    if (identityChecked) {
      const { error: auditError } = await admin.rpc('log_audit', {
        p_actor: viewer.user.id,
        p_action: 'attendance.identity_checked',
        p_target_type: data ? 'attendance' : 'device_scan',
        p_target_id: data ? String(data) : payload.scanId,
        p_reason: 'PSU ID checked after a photo change within 48 hours',
        p_before: null,
        p_after: { photo_changed_within_hours: 48, scan_id: payload.scanId },
        p_request_id: id,
      });
      if (auditError) console.error(`[kiosk:${id}]`, auditError.message);
    }

    return jsonOk({ ok: true, attendanceId: data ?? null, requestId: id });
  } catch (error) {
    return handleApiError(error, id);
  }
}
