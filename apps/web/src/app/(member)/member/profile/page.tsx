import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { buttonVariants, PageShell, SectionHeading } from '@gdg/ui';
import { requireMember } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { profilePhotoUrl } from '@/lib/profile/photo';
import { readVisibility, VISIBILITY_SELECT } from '@/lib/profile/visibility';
import { ProfileForm } from '@/components/member/profile-form';
import { PrivacyForm } from '@/components/member/privacy-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your profile',
  robots: { index: false, follow: false },
};

export default async function ProfilePage() {
  const { member } = await requireMember();
  const admin = createSupabaseAdmin();
  const { data: profile } = await admin
    .from('member_profiles')
    .select(`display_name, about, links, photo_path, profile_slug, ${VISIBILITY_SELECT}`)
    .eq('member_id', member.id)
    .maybeSingle();
  const row = (profile ?? {}) as unknown as Record<string, unknown>;

  const links = Array.isArray(row.links)
    ? (row.links as { label?: string; url?: string }[])
        .filter((link) => typeof link?.label === 'string' && typeof link?.url === 'string')
        .map((link) => ({ label: link.label as string, url: link.url as string }))
    : [];
  const slug = (row.profile_slug as string | undefined) ?? member.slug;

  return (
    <PageShell width="lg" className="pb-10 pt-6 sm:pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          headingLevel={1}
          eyebrow="Your public page"
          title="Your profile"
          description="What people see when they tap your card or open your link. Organizers check your name and photo at events."
        />
        <Link
          href={`/m/${slug}`}
          className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'mb-6' })}
        >
          <ExternalLink className="size-4" aria-hidden />
          View my public page
        </Link>
      </div>

      <ProfileForm
        initialName={(row.display_name as string | undefined) ?? member.displayName}
        initialAbout={(row.about as string | null | undefined) ?? ''}
        initialLinks={links}
        photoUrl={profilePhotoUrl(member.slug)}
      />

      <h2 id="privacy" className="type-h3 mb-1 mt-10 scroll-mt-24">
        What others can see
      </h2>
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        Switch off anything you would rather keep to yourself. A private profile hides everything.
      </p>
      <div className="max-w-2xl">
        <PrivacyForm initial={readVisibility(row)} />
      </div>
    </PageShell>
  );
}
