import type { Metadata } from 'next';
import { PageShell, SectionHeading } from '@gdg/ui';
import { requireMember } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { profilePhotoUrl } from '@/lib/profile/photo';
import { ProfileForm } from '@/components/member/profile-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Edit profile',
  robots: { index: false, follow: false },
};

export default async function ProfilePage() {
  const { member } = await requireMember();
  const admin = createSupabaseAdmin();
  const { data: profile } = await admin
    .from('member_profiles')
    .select('display_name, about, links, photo_path, profile_slug')
    .eq('member_id', member.id)
    .maybeSingle();

  const links = Array.isArray(profile?.links)
    ? (profile.links as { label?: string; url?: string }[])
        .filter((link) => typeof link?.label === 'string' && typeof link?.url === 'string')
        .map((link) => ({ label: link.label as string, url: link.url as string }))
    : [];

  return (
    <PageShell width="lg" className="pb-10 pt-6 sm:pt-8">
      <SectionHeading
        headingLevel={1}
        eyebrow="Public identity"
        title="Your profile"
        description={`This is what people see at /m/${profile?.profile_slug ?? member.slug}. Your name and a clear face photo are required for identity checks, but you can hide either from the public view in Privacy.`}
      />
      <ProfileForm
        initialName={profile?.display_name ?? member.displayName}
        initialAbout={(profile?.about as string | null) ?? ''}
        initialLinks={links}
        photoUrl={profilePhotoUrl(member.slug)}
      />
    </PageShell>
  );
}
