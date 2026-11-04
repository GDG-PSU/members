import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button, buttonVariants, Card, CardContent } from '@gdg/ui';
import { SetupForm } from '@/components/auth/setup-form';
import { getViewer } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { SUPPORT_EMAIL } from '@/lib/env';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Finish your membership',
  robots: { index: false, follow: false },
};

export default async function InviteAcceptPage() {
  const viewer = await getViewer();
  if (!viewer.user) redirect('/login');
  if (viewer.member) redirect('/member');

  const admin = createSupabaseAdmin();
  const { data: invitation } = await admin
    .from('member_invitations')
    .select('id, email, status, paid_since, expires_at, requires_password')
    .eq('email', (viewer.user.email ?? '').toLowerCase())
    .order('created_at', { ascending: false })
    // An email can have older revoked or accepted rows; maybeSingle() returns
    // nothing at all when more than one row matches.
    .limit(1)
    .maybeSingle();

  const expired = invitation?.expires_at ? new Date(invitation.expires_at) < new Date() : false;
  const usable = invitation?.status === 'pending' && !expired;

  if (usable) {
    const requirePassword = invitation.requires_password !== false;
    return (
      <div className="space-y-5">
        <div>
          <p className="type-overline text-primary">One-time setup</p>
          <h1 className="type-h2 mt-2">Make it yours</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {requirePassword
              ? 'Set a password, add your name and a face photo.'
              : 'Your password stays the same. Add your name and a face photo.'}{' '}
            Membership since {formatDate(invitation.paid_since)}.
          </p>
        </div>
        <SetupForm email={viewer.user.email ?? ''} requirePassword={requirePassword} />
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6 sm:p-8">
        <p className="type-overline text-primary">Membership</p>
        <h1 className="type-h2 mt-2">
          {invitation?.status === 'accepted'
            ? 'This invitation was already used'
            : expired
              ? 'This invitation has expired'
              : invitation?.status === 'revoked'
                ? 'This invitation was revoked'
                : 'No active invitation found'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Signed in as <span className="font-semibold text-foreground">{viewer.user.email}</span>.
          Invitations are single-use and expire after 14 days.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Email <span className="font-semibold text-foreground">{SUPPORT_EMAIL}</span> for a fresh
          invitation.
        </p>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('GDG@PSU invitation help')}`}
            className={buttonVariants({})}
          >
            Contact organizers
          </a>
          <form action="/api/auth/signout" method="post">
            <Button type="submit" variant="secondary" className="w-full sm:w-auto">
              Sign out
            </Button>
          </form>
          <Link href="/" className={buttonVariants({ variant: 'ghost' })}>
            Go home
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
