import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert, Card, CardContent } from '@gdg/ui';
import { LoginForm } from '@/components/auth/login-form';
import { getViewer } from '@/lib/auth/viewer';
import { SUPPORT_EMAIL } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; next?: string }>;
}) {
  const viewer = await getViewer();
  if (viewer.user) {
    redirect(viewer.member ? '/member' : viewer.isAdmin ? '/admin' : '/invite/accept');
  }
  const { notice } = await searchParams;

  return (
    <div>
      <Card className="overflow-hidden">
        <div
          aria-hidden
          className="h-1.5 w-full bg-[linear-gradient(90deg,#4285f4_0%,#ea4335_25%,#fbbc04_50%,#34a853_75%,#4285f4_100%)]"
        />
        <CardContent className="p-6 sm:p-8">
          <p className="type-overline text-primary">Member access</p>
          <h1 className="type-h2 mt-2">Welcome back</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Use the email your invitation was sent to.
          </p>

          <div className="mt-5 space-y-3">
            {notice === 'signed-out' ? (
              <Alert variant="success">You have been signed out.</Alert>
            ) : null}
            {notice === 'invalid-link' ? (
              <Alert variant="danger">
                That sign-in link is invalid or has already been used. Ask GDG@PSU for a fresh link,
                or sign in with your password.
              </Alert>
            ) : null}
          </div>

          <div className="mt-5">
            <LoginForm />
          </div>

          <div className="my-6 border-t border-border" />

          <div className="space-y-2.5 text-[0.82rem] leading-relaxed text-muted-foreground">
            <p>
              Forgot your password? Email{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=GDG%40PSU%20password%20reset`}
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                {SUPPORT_EMAIL}
              </a>{' '}
              from your registered address. An admin will send a recovery link.
            </p>
            <p>Not a member yet? Membership opens after dues are recorded — no public signup.</p>
            <Link
              href="/forgot-password"
              className="inline-flex font-semibold text-primary underline-offset-2 hover:underline"
            >
              Password help
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="mt-5 text-center">
        <Link
          href="/"
          className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Back to MemberPass
        </Link>
      </div>
    </div>
  );
}
