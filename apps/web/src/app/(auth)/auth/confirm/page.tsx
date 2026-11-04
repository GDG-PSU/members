import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Alert, Card, CardContent } from '@gdg/ui';
import { SubmitButton } from '@/components/admin/ui';
import { getViewer } from '@/lib/auth/viewer';
import { isEmailLinkType, safeAuthNextPath } from '@/lib/security/request';
import { confirmLinkAction } from './actions';

export const metadata: Metadata = {
  title: 'Continue with your link',
  robots: { index: false, follow: false },
};

/**
 * Confirms an admin-generated invite or recovery link on our own origin. Loading
 * this page must not use the token: chat previews and mail scanners fetch links as
 * soon as they are shared, and used to burn them before the person saw them.
 */
export default async function ConfirmLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const { token_hash: tokenHash, type, next } = await searchParams;
  if (!tokenHash || !isEmailLinkType(type)) redirect('/login?notice=invalid-link');

  const viewer = await getViewer();

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6 sm:p-8">
        <p className="type-overline text-primary">One-time link</p>
        <h1 className="type-h2 mt-2">Continue to your account</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This link works once. Continue only if it was sent to you.
        </p>

        {viewer.user ? (
          <div className="mt-5">
            <Alert variant="warning">
              You are signed in as {viewer.user.email}. Continuing switches this browser to the
              account this link is for.
            </Alert>
          </div>
        ) : null}

        <form action={confirmLinkAction} className="mt-6">
          <input type="hidden" name="tokenHash" value={tokenHash} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="next" value={safeAuthNextPath(next)} />
          <SubmitButton pendingLabel="Continuing…" fullWidth className="h-11">
            Continue
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
