import type { Metadata } from 'next';
import { PageShell, SectionHeading } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { UsbDevicePanel } from '@/components/admin/usb-device-panel';
import { UsbCardPreparation } from '@/components/admin/usb-card-preparation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'USB devices',
  robots: { index: false, follow: false },
};

export default async function UsbDevicesPage() {
  await requireAdmin();
  const admin = createSupabaseAdmin();
  const { data: members } = await admin
    .from('members')
    .select('id, public_number, member_profiles(display_name)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(300);

  const memberOptions = (members ?? []).map((row) => {
    const profile = Array.isArray(row.member_profiles)
      ? row.member_profiles[0]
      : row.member_profiles;
    return {
      id: row.id as string,
      label: `${(profile?.display_name as string) ?? 'Member'} · ${row.public_number as string}`,
    };
  });

  return (
    <PageShell>
      <SectionHeading
        eyebrow="Hardware"
        title="USB devices"
        description="Connect any lane directly from this browser. No server registration is required."
        headingLevel={1}
      />
      <UsbCardPreparation members={memberOptions} />
      <SectionHeading
        eyebrow="Writer"
        title="Connect a lane"
        description="Read a tag, write a prepared URL, and verify the read-back before activating the card."
        headingLevel={2}
      />
      <UsbDevicePanel />
    </PageShell>
  );
}
