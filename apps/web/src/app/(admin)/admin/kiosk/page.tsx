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

export default async function KioskPage() {
  await requireAdmin();
  const admin = createSupabaseAdmin();

  const { data: sessionRows } = await admin
    .from('event_sessions')
    .select(
      'id, name, kind, starts_at, check_in_opens_at, check_out_closes_at, is_enabled, events(name, status)',
    )
    .eq('is_enabled', true)
    .order('starts_at', { ascending: false })
    .limit(40);

  const sessions: KioskSessionOption[] = (sessionRows ?? []).flatMap((session) => {
    const event = Array.isArray(session.events) ? session.events[0] : session.events;
    if (event?.status === 'cancelled') return [];
    const kind = session.kind === 'bonus' ? ' · bonus' : '';
    return [
      {
        id: session.id as string,
        label: `${(event?.name as string) ?? 'Event'} · ${session.name as string}${kind} · ${formatDateTime(
          session.starts_at as string,
        )}`,
      },
    ];
  });

  return (
    <PageShell>
      <SectionHeading
        eyebrow="USB attendance"
        title="Kiosk"
        description="Read a member card over the local USB lane, verify the person, then confirm check-in or check-out."
        headingLevel={1}
      />
      <UsbKioskPanel sessions={sessions} />
    </PageShell>
  );
}
