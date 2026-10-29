import type { Metadata } from 'next';
import { PageShell } from '@gdg/ui';
import { defaultVisibility, type Visibility } from '@gdg/contracts';
import { requireMember } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { PrivacyForm } from '@/components/member/privacy-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Privacy settings',
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

export default async function PrivacySettingsPage() {
  const { member } = await requireMember();
  const admin = createSupabaseAdmin();
  const { data } = await admin
    .from('member_profiles')
    .select(Object.values(columnMap).join(', '))
    .eq('member_id', member.id)
    .maybeSingle();

  const initial = { ...defaultVisibility };
  if (data) {
    for (const key of Object.keys(columnMap) as (keyof Visibility)[]) {
      const value = data[columnMap[key] as keyof typeof data];
      if (typeof value === 'boolean') initial[key] = value;
    }
  }

  return (
    <PageShell width="lg" className="pb-10 pt-6 sm:pt-8">
      <div className="grid gap-6 md:grid-cols-[0.75fr_1.25fr] md:gap-8">
        <div className="md:sticky md:top-24 md:self-start">
          <p className="type-overline text-primary">Your call</p>
          <h1 className="type-h2 mt-2">Privacy settings</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Everything here can be changed at any time. Email is public by default, but you can hide
            it. Turning off the public profile hides every field at once.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            The leaderboard only includes public profiles with both points and leaderboard
            visibility enabled.
          </p>
        </div>
        <div className="min-w-0">
          <PrivacyForm initial={initial} />
        </div>
      </div>
    </PageShell>
  );
}
