import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { buttonVariants, PageShell, SectionHeading } from '@gdg/ui';
import { defaultVisibility, type Visibility } from '@gdg/contracts';
import { requireProfile } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { profilePhotoUrl } from '@/lib/profile/photo';
import { ProfileForm } from '@/components/member/profile-form';
import { PrivacyForm } from '@/components/member/privacy-form';
import { Flash } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My profile',
  robots: { index: false, follow: false },
};

const columnMap: Record<keyof Visibility, string> = {
  publicProfile: 'public_profile',
  showDisplayName: 'show_display_name',
  showPhoto: 'show_photo',
  showAbout: 'show_about',
  showLinks: 'show_links',
  showMemberNumber: 'show_member_number',
  showMemberSince: 'show_member_since',
  showPoints: 'show_points',
  showStars: 'show_stars',
  showEvents: 'show_events',
  showOnLeaderboard: 'show_on_leaderboard',
  showEmail: 'show_email',
};

/** An organizer's own profile: what their card opens when someone taps it. */
export default async function StaffProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { profile: own } = await requireProfile();
  const { notice, error } = await searchParams;
  const { data: profile } = await createSupabaseAdmin()
    .from('member_profiles')
    .select(`display_name, about, links, photo_path, ${Object.values(columnMap).join(', ')}`)
    .eq('member_id', own.memberId)
    .maybeSingle();
  const row = (profile ?? {}) as unknown as Record<string, unknown>;

  const links = Array.isArray(row.links)
    ? (row.links as { label?: string; url?: string }[])
        .filter((link) => typeof link?.label === 'string' && typeof link?.url === 'string')
        .map((link) => ({ label: link.label as string, url: link.url as string }))
    : [];
  const visibility = { ...defaultVisibility };
  for (const key of Object.keys(columnMap) as (keyof Visibility)[]) {
    const value = row[columnMap[key]];
    if (typeof value === 'boolean') visibility[key] = value;
  }

  return (
    <PageShell width="lg" className="pb-10">
      <Flash notice={notice} error={error} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          headingLevel={1}
          eyebrow="Organizer"
          title="My profile"
          description="What people see when they tap your card."
        />
        <Link
          href={`/m/${own.slug}`}
          className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'mb-6' })}
        >
          <ExternalLink className="size-4" aria-hidden />
          View my public page
        </Link>
      </div>

      <ProfileForm
        organizer
        initialName={(row.display_name as string | undefined) ?? own.displayName}
        initialAbout={(row.about as string | null | undefined) ?? ''}
        initialLinks={links}
        photoUrl={row.photo_path ? profilePhotoUrl(own.slug) : null}
      />

      <h2 className="type-h3 mb-4 mt-10">What is shown</h2>
      <div className="max-w-2xl">
        <PrivacyForm organizer initial={visibility} />
      </div>
    </PageShell>
  );
}
