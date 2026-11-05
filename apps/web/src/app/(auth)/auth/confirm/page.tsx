import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert, buttonVariants, Card, CardContent } from '@gdg/ui';
import { SubmitButton } from '@/components/admin/ui';
import { getViewer } from '@/lib/auth/viewer';
import { LINK_HOURS } from '@/lib/auth/link-rules';
import { peekSignInLink } from '@/lib/auth/sign-in-links';
import { SUPPORT_EMAIL } from '@/lib/env';
import { isEmailLinkType, safeAuthNextPath } from '@/lib/security/request';
import { confirmLinkAction } from './actions';

export const metadata: Metadata = {
  title: 'Continue with your link',
  robots: { index: false, follow: false },
};

/**
 * Confirms an admin-generated invite or recovery link on our own origin. Loading
 * this page must not use the link: chat previews and mail scanners fetch links as
 * soon as they are shared, and used to burn them before the person saw them.
 */
export default async function ConfirmLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string; token_hash?: string; type?: string; next?: string }>;
}) {
  const { link, token_hash: tokenHash, type, next } = await searchParams;
  const legacy = !link && tokenHash && isEmailLinkType(type);
  if (!link && !legacy) redirect('/login?notice=invalid-link');

  // Looking is free: only the button spends the link.
  const peeked = link ? await peekSignInLink(link) : null;
  if (peeked?.state === 'unknown') redirect('/login?notice=invalid-link');

  if (peeked && peeked.state !== 'valid') {
    const invitation = peeked.purpose !== 'recovery';
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-6 sm:p-8">
          <p className="type-overline text-primary">One-time link</p>
          <h1 className="type-h2 mt-2">
            {peeked.state === 'used' ? 'This link was already used' : 'This link has expired'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {peeked.state === 'used'
              ? 'Each link works once. If you already set a password, sign in with it.'
              : invitation
                ? `An invitation link works for ${LINK_HOURS.member_invite} hours.`
                : `A password reset link works for ${LINK_HOURS.recovery} hours.`}{' '}
            Email {SUPPORT_EMAIL} and an organizer can send a new one.
          </p>
          <Link
            href="/login"
            className={buttonVariants({ variant: 'secondary', className: 'mt-6' })}
          >
            Go to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

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
          {link ? (
            <input type="hidden" name="link" value={link} />
          ) : (
            <>
              <input type="hidden" name="tokenHash" value={tokenHash} />
              <input type="hidden" name="type" value={type} />
              <input type="hidden" name="next" value={safeAuthNextPath(next)} />
            </>
          )}
          <SubmitButton pendingLabel="Continuing…" fullWidth className="h-11">
            Continue
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
