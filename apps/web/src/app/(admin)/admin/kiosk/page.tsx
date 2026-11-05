import type { Metadata } from 'next';
import { PageShell, SectionHeading } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';
import { UsbKioskPanel, type KioskSessionOption } from '@/components/admin/usb-kiosk-panel';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Kiosk',
  robots: { index: false, follow: false },
};

async function loadSessions(): Promise<KioskSessionOption[]> {
  const admin = createSupabaseAdmin();
  const { data: sessionRows } = await admin
    .from('event_sessions')
    .select(
      'id, name, kind, starts_at, check_in_opens_at, check_out_closes_at, is_enabled, events(name, status)',
    )
    .eq('is_enabled', true)
    .order('starts_at', { ascending: false })
    .limit(40);

  const now = Date.now();
  const rows = (sessionRows ?? []).flatMap((session) => {
    const event = Array.isArray(session.events) ? session.events[0] : session.events;
    if (event?.status === 'cancelled') return [];
    const open =
      now >= new Date(session.check_in_opens_at as string).getTime() &&
      now <= new Date(session.check_out_closes_at as string).getTime();
    const kind = session.kind === 'bonus' ? ' · bonus' : '';
    return [
      {
        id: session.id as string,
        open,
        label: `${(event?.name as string) ?? 'Event'} · ${session.name as string}${kind} · ${
          open ? 'open now' : formatDateTime(session.starts_at as string)
        }`,
      },
    ];
  });
  // Whatever is running right now is almost always the one the organizer wants.
  return [...rows.filter((row) => row.open), ...rows.filter((row) => !row.open)].map(
    ({ id, label }) => ({ id, label }),
  );
}

export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  await requireAdmin();
  const { session: requestedSession } = await searchParams;

  const sessions = await loadSessions();

  return (
    <PageShell>
      <SectionHeading
        eyebrow="Attendance"
        title="Kiosk"
        description="Tap a card, check the face, confirm."
        headingLevel={1}
      />
      <UsbKioskPanel sessions={sessions} initialSessionId={requestedSession} />
    </PageShell>
  );
}
