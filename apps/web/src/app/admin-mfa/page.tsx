import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@gdg/ui';
import { getViewer } from '@/lib/auth/viewer';
import { MfaPanel } from '@/components/admin/mfa-panel';
import { SUPPORT_EMAIL } from '@/lib/env';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Organizer security',
  robots: { index: false, follow: false },
};

export default async function AdminMfaPage() {
  const viewer = await getViewer();
  if (!viewer.user) redirect('/login');
  if (!viewer.isAdmin) redirect('/');

  const { data: assurance } = await viewer.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel === 'aal2') redirect('/admin');

  const { data: factors } = await viewer.supabase.auth.mfa.listFactors();
  const verified = (factors?.totp ?? []).filter((factor) => factor.status === 'verified');

  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-10 sm:py-14">
      <div className="w-full max-w-lg">
        <Card className="overflow-hidden">
          <div
            aria-hidden
            className="h-1.5 w-full bg-[linear-gradient(90deg,var(--primary),#4285f4,#0d7a72)]"
          />
          <CardContent className="p-6 sm:p-8">
            <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <p className="type-overline mt-4 text-primary">Organizer security</p>
            <h1 className="type-h2 mt-2">Two-factor required</h1>
            <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
              Admin routes require a verified authenticator (TOTP) session. This protects member
              data, the points ledger and every event control.
            </p>

            <div className="mt-6">
              <MfaPanel
                hasVerifiedFactor={verified.length > 0}
                email={viewer.user.email ?? ''}
                verifiedFactorId={verified[0]?.id}
              />
            </div>

            <div className="mt-6 border-t border-border pt-4">
              <p className="text-[0.78rem] leading-relaxed text-muted-foreground">
                Lost your authenticator? Contact {SUPPORT_EMAIL} — an organizer with account access
                must reset the factor from Supabase.
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
