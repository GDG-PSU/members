import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { getApiViewer } from '@/lib/auth/api-guard';
import { jsonError, jsonOk, requestId } from '@/lib/api';
import { publicPhotoUrl } from '@/lib/profile/photo';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const id = requestId(request);
  const viewer = await getApiViewer();
  if (!viewer) return jsonError(401, 'unauthorized', 'Sign in as an organizer.', id);
  if (!viewer.isAdmin) return jsonError(403, 'forbidden', 'Organizer access required.', id);

  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('device_scans')
    .select(
      'id, member_id, action, created_at, expires_at, members(public_number, member_profiles(display_name, photo_path)), event_sessions(name, events(name)), devices(lane_label)',
    )
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(20);

  if (error) {
    console.error(`[kiosk:${id}]`, error.message);
    return jsonError(500, 'internal_error', 'Could not load pending scans.', id);
  }

  const scans = (data ?? []).map((scan) => {
    const member = Array.isArray(scan.members) ? scan.members[0] : scan.members;
    const profile = Array.isArray(member?.member_profiles) ? member.member_profiles[0] : member?.member_profiles;
    const session = Array.isArray(scan.event_sessions) ? scan.event_sessions[0] : scan.event_sessions;
    const event = Array.isArray(session?.events) ? session.events[0] : session?.events;
    const device = Array.isArray(scan.devices) ? scan.devices[0] : scan.devices;
    return {
      id: scan.id,
      memberId: scan.member_id,
      memberName: profile?.display_name ?? 'Member',
      memberNumber: member?.public_number ?? '',
      photoUrl: publicPhotoUrl(profile?.photo_path ?? null),
      eventName: event?.name ?? 'Event',
      sessionName: session?.name ?? 'Session',
      suggestedAction: scan.action ?? 'check_in',
      lane: device?.lane_label ?? 'Kiosk',
      createdAt: scan.created_at,
      expiresAt: scan.expires_at,
    };
  });

  return jsonOk({ scans, serverTime: new Date().toISOString() });
}
