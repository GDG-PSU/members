import type { Metadata } from 'next';
import { Card, CardContent, PageShell, SectionHeading, StatusChip } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { profilePhotoUrl } from '@/lib/profile/photo';
import { photoChangedWithin } from '@/lib/profile/identity';
import { formatDateTime } from '@/lib/format';
import { KioskQueue } from '@/components/admin/kiosk-queue';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Kiosk',
  robots: { index: false, follow: false },
};

export default async function KioskPage() {
  await requireAdmin();
  const admin = createSupabaseAdmin();

  const [scans, devices] = await Promise.all([
    admin
      .from('device_scans')
      .select(
        'id, action, status, created_at, expires_at, member_id, members(public_number, member_profiles(display_name, profile_slug, photo_changed_at)), event_sessions(name, events(name)), devices(device_id, lane_label)',
      )
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(10),
    admin
      .from('devices')
      .select('id, device_id, lane_label, mode, status, last_seen_at, firmware_version')
      .order('lane_label'),
  ]);

  const initialScans = (scans.data ?? []).map((scan) => {
    const member = Array.isArray(scan.members) ? scan.members[0] : scan.members;
    const profile = Array.isArray(member?.member_profiles)
      ? member.member_profiles[0]
      : member?.member_profiles;
    const session = Array.isArray(scan.event_sessions)
      ? scan.event_sessions[0]
      : scan.event_sessions;
    const event = Array.isArray(session?.events) ? session.events[0] : session?.events;
    const device = Array.isArray(scan.devices) ? scan.devices[0] : scan.devices;
    const photoChangedAt = (profile?.photo_changed_at as string | undefined) ?? null;
    return {
      id: scan.id as string,
      memberId: scan.member_id as string,
      memberName: (profile?.display_name as string) ?? 'Member',
      memberNumber: (member?.public_number as string) ?? '',
      photoUrl: profilePhotoUrl((profile?.profile_slug as string) ?? null),
      photoChangedAt,
      photoChangedRecently: photoChangedWithin(photoChangedAt),
      eventName: (event?.name as string) ?? 'Event',
      sessionName: (session?.name as string) ?? 'Session',
      suggestedAction: (scan.action as string) ?? 'check_in',
      lane: (device?.lane_label as string) ?? 'Kiosk',
      createdAt: scan.created_at as string,
      expiresAt: scan.expires_at as string,
    };
  });

  return (
    <PageShell>
      <SectionHeading
        eyebrow="Human confirmation required"
        title="Kiosk"
        description="Confirm every scan in person. A tap never awards points."
        headingLevel={1}
        action={
          <StatusChip
            status={initialScans.length > 0 ? 'active' : 'draft'}
            label={`${initialScans.length} pending`}
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.6fr_0.9fr] lg:items-start">
        <div>
          <KioskQueue initialScans={initialScans} />
        </div>

        <aside>
          <Card className="lg:sticky lg:top-24">
            <CardContent className="p-5">
              <h2 className="type-h3 mb-4">Lanes</h2>
              <div className="space-y-2.5">
                {(devices.data ?? []).map((device) => (
                  <div
                    key={device.id as string}
                    className="rounded-xl border border-border bg-subtle/60 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{device.lane_label as string}</p>
                      <StatusChip status={device.status as string} />
                    </div>
                    <p className="mt-1 text-[0.72rem] text-muted-foreground">
                      {device.device_id as string} · {device.mode as string}
                    </p>
                    <p className="text-[0.72rem] text-muted-foreground">
                      Last seen:{' '}
                      {device.last_seen_at
                        ? formatDateTime(device.last_seen_at as string)
                        : 'never'}
                      {device.firmware_version ? ` · ${device.firmware_version as string}` : ''}
                    </p>
                  </div>
                ))}
                {(devices.data ?? []).length === 0 ? (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    No devices registered.
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </PageShell>
  );
}
