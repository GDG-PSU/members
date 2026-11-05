import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { IdCard } from 'lucide-react';
import { Card, CardContent } from '@gdg/ui';
import { getViewer } from '@/lib/auth/viewer';
import { StaffSetupForm } from '@/components/admin/staff-setup-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Set up your profile',
  robots: { index: false, follow: false },
};

/**
 * The last step for a new organizer: the profile their card will open. It sits
 * outside the admin area, because every admin page sends an organizer without a
 * profile here.
 */
export default async function AdminSetupPage() {
  const viewer = await getViewer();
  if (!viewer.user) redirect('/login');
  if (!viewer.isAdmin) redirect('/');
  const { data: assurance } = await viewer.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== 'aal2') redirect('/admin-mfa');
  if (viewer.profile) redirect('/admin');

  const emailName = (viewer.user.email ?? '').split('@')[0] ?? '';

  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-10 sm:py-14">
      <div className="w-full max-w-lg">
        <Card className="overflow-hidden">
          <CardContent className="p-6 sm:p-8">
            <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
              <IdCard className="size-5" aria-hidden />
            </span>
            <p className="type-overline mt-4 text-primary">One last step</p>
            <h1 className="type-h2 mt-2">Set up your profile</h1>
            <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
              Your organizer card opens this profile when someone taps it. You can change it later.
            </p>

            <div className="mt-6">
              <StaffSetupForm suggestedName={emailName.length >= 2 ? emailName : ''} />
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
