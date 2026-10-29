import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardContent } from '@gdg/ui';
import { PasswordForm } from '@/components/auth/password-form';
import { getViewer } from '@/lib/auth/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Set a new password',
  robots: { index: false, follow: false },
};

export default async function AccountPasswordPage() {
  const viewer = await getViewer();
  if (!viewer.user) redirect('/login?next=/account/password');

  return (
    <div className="space-y-5">
      <div>
        <p className="type-overline text-primary">Account recovery</p>
        <h1 className="type-h2 mt-2">Set a new password</h1>
      </div>
      <Card>
        <CardContent className="p-6 sm:p-8">
          <PasswordForm email={viewer.user.email ?? ''} />
        </CardContent>
      </Card>
    </div>
  );
}
