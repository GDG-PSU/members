import type { Metadata } from 'next';
import { Card, CardContent, EmptyState, PageShell, SectionHeading, StatusChip } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';
import {
  DeviceCreateForm,
  DeviceEditForm,
  type EventOption,
} from '@/components/admin/device-forms';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Devices',
  robots: { index: false, follow: false },
};

export default async function DevicesPage() {
  await requireAdmin();
  const admin = createSupabaseAdmin();

  const [devices, events] = await Promise.all([
    admin
      .from('devices')
      .select(
        'id, device_id, lane_label, mode, status, last_seen_at, firmware_version, event_id, session_id, rotated_at',
      )
      .order('lane_label'),
    admin
      .from('events')
      .select('id, name, event_sessions(id, name, kind)')
      .in('status', ['draft', 'published'])
      .order('starts_at', { ascending: false })
      .limit(20),
  ]);

  const eventOptions: EventOption[] = (events.data ?? []).map((event) => ({
    id: event.id as string,
    name: event.name as string,
    sessions: (Array.isArray(event.event_sessions) ? event.event_sessions : []).map((session) => ({
      id: session.id as string,
      name: session.name as string,
      kind: session.kind as string,
    })),
  }));

  return (
    <PageShell>
      <div className="grid gap-8 lg:grid-cols-[1.35fr_0.65fr] lg:items-start">
        <section>
          <SectionHeading
            eyebrow="Hardware"
            title="Devices"
            description="Each ESP32 lane authenticates with its own ID and secret. Writer mode temporarily stops attendance scans on that lane."
            headingLevel={1}
          />

          {!devices.data || devices.data.length === 0 ? (
            <EmptyState
              title="No devices registered"
              description="Register lane A and lane B before event day."
            />
          ) : (
            <div className="space-y-3">
              {devices.data.map((device) => (
                <Card key={device.id as string}>
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-base font-bold leading-tight">
                          {device.lane_label as string}
                        </h2>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {device.device_id as string} · last seen{' '}
                          {device.last_seen_at
                            ? formatDateTime(device.last_seen_at as string)
                            : 'never'}
                          {device.firmware_version
                            ? ` · fw ${device.firmware_version as string}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusChip status={device.status as string} />
                        <StatusChip status={device.mode as string} />
                      </div>
                    </div>

                    <div className="mt-4 border-t border-border pt-4">
                      <DeviceEditForm
                        device={{
                          id: device.id as string,
                          deviceId: device.device_id as string,
                          laneLabel: device.lane_label as string,
                          mode: device.mode as string,
                          status: device.status as string,
                          eventId: (device.event_id as string | null) ?? null,
                          sessionId: (device.session_id as string | null) ?? null,
                        }}
                        events={eventOptions}
                      />
                    </div>

                    <p className="mt-3 text-[0.72rem] leading-relaxed text-muted-foreground">
                      Rotating the secret takes effect on the device&apos;s next request. Update the
                      firmware secrets file before restarting that lane.
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        <aside>
          <Card className="lg:sticky lg:top-24">
            <CardContent className="p-5">
              <h2 className="type-h3">Register a lane</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                The secret is shown once. Only its SHA-256 hash is stored; firmware never receives a
                Supabase key.
              </p>
              <div className="mt-4">
                <DeviceCreateForm events={eventOptions} />
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </PageShell>
  );
}
