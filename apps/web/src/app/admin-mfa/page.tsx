import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@gdg/ui';
import { getViewer } from '@/lib/auth/viewer';
import { MfaPanel } from '@/components/admin/mfa-panel';
import { safeReturnPath } from '@/lib/security/request';
import { SUPPORT_EMAIL } from '@/lib/env';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Organizer security',
  robots: { index: false, follow: false },
};

export default async function AdminMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeReturnPath((await searchParams).next, 'admin');
  const viewer = await getViewer();
  if (!viewer.user) redirect('/login');
  if (!viewer.isAdmin) redirect('/');

  const { data: assurance } = await viewer.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel === 'aal2') redirect(next ?? '/admin');

  const { data: factors } = await viewer.supabase.auth.mfa.listFactors();
  const verified = (factors?.totp ?? []).filter((factor) => factor.status === 'verified');

  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-10 sm:py-14">
      <div className="w-full max-w-lg">
        <Card className="overflow-hidden">
          <CardContent className="p-6 sm:p-8">
            <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <p className="type-overline mt-4 text-primary">Organizer security</p>
            <h1 className="type-h2 mt-2">Two-factor required</h1>
            <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
              Organizer pages need a six-digit code from an authenticator app, such as Google
              Authenticator.
            </p>

            <div className="mt-6">
              <MfaPanel
                hasVerifiedFactor={verified.length > 0}
                email={viewer.user.email ?? ''}
                verifiedFactorId={verified[0]?.id}
                next={next ?? undefined}
              />
            </div>

            <div className="mt-6 border-t border-border pt-4">
              <p className="text-[0.78rem] leading-relaxed text-muted-foreground">
                Lost your authenticator? Contact {SUPPORT_EMAIL} for a reset.
              </p>
              <form action="/api/auth/signout" method="post" className="mt-2">
                <button
                  type="submit"
                  className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Sign out
                </button>
              </form>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
