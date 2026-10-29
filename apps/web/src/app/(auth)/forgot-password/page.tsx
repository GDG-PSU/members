import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonVariants, Card, CardContent } from '@gdg/ui';
import { SUPPORT_EMAIL } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Password help',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('GDG@PSU password reset')}&body=${encodeURIComponent(
    'Hi organizers,\n\nPlease send me a password reset link for my GDG@PSU member account.\n\nRegistered email:\n',
  )}`;

  return (
    <Card className="overflow-hidden">
      <div
        aria-hidden
        className="h-1.5 w-full bg-[linear-gradient(90deg,#4285f4_0%,#ea4335_25%,#fbbc04_50%,#34a853_75%,#4285f4_100%)]"
      />
      <CardContent className="p-6 sm:p-8">
        <p className="type-overline text-primary">Account recovery</p>
        <h1 className="type-h2 mt-2">Password help, handled by a person</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Member password resets are not self-service. Email GDG@PSU from your registered address
          and an organizer will trigger a single-use Supabase recovery link for your account.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          We will never ask for your password or send one by email.
        </p>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <a href={mailto} className={buttonVariants({})}>
            Email {SUPPORT_EMAIL}
          </a>
          <Link href="/login" className={buttonVariants({ variant: 'secondary' })}>
            Back to sign in
          </Link>
        </div>
        <div className="mt-6 rounded-xl border border-border bg-subtle/70 p-3.5">
          <p className="text-[0.78rem] leading-relaxed text-muted-foreground">
            Organizers: recovery is initiated from Admin → Members → a member → &quot;Send recovery
            link&quot;. The action is audited and never exposes the token in the admin UI.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
