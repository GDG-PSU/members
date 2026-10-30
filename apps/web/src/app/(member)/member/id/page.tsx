import type { Metadata } from 'next';
import Link from 'next/link';
import QRCode from 'qrcode';
import { BadgeCheck, Nfc } from 'lucide-react';
import { Badge, buttonVariants, Card, CardContent, PageShell, SectionHeading } from '@gdg/ui';
import { requireMember } from '@/lib/auth/viewer';
import { SITE_URL } from '@/lib/env';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Digital ID',
  robots: { index: false, follow: false },
};

export default async function DigitalIdPage() {
  const { member } = await requireMember();
  const profileUrl = `${SITE_URL}/m/${member.slug}`;
  const qr = await QRCode.toDataURL(profileUrl, {
    width: 640,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#0b1220', light: '#ffffff' },
  });

  return (
    <PageShell width="md" className="pb-10 pt-6 sm:pt-8">
      <SectionHeading
        headingLevel={1}
        eyebrow="Card-free fallback"
        title="Your digital ID"
        description="Show this if your card is unavailable. It is not a password."
      />

      <Card className="mx-auto max-w-md overflow-hidden">
        <div className="relative overflow-hidden bg-[linear-gradient(135deg,#101d45_0%,#0d1a3c_45%,#0a3b39_100%)] px-5 py-4 text-white">
          <div
            aria-hidden
            className="absolute -right-10 -top-16 size-40 rounded-full bg-white/10 blur-2xl"
          />
          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-white/80">
              MemberPass
            </span>
            <Nfc className="size-4 text-white/60" aria-hidden />
          </div>
          <p className="mt-5 font-mono text-[0.7rem] tracking-[0.18em] text-white/50">
            GDG @ PENN STATE
          </p>
          <p className="mt-0.5 truncate text-[0.82rem] font-semibold text-white/90">
            {member.displayName}
          </p>
        </div>

        <CardContent className="flex flex-col items-center gap-4 p-5 pt-6 text-center sm:p-6">
          <Badge variant="outline" className="font-mono tracking-wide">
            <BadgeCheck className="size-3.5" aria-hidden />
            {member.publicNumber}
          </Badge>

          <div className="rounded-2xl border border-border bg-white p-3 shadow-card">
            {/* eslint-disable-next-line @next/next/no-img-element -- QR data URLs cannot use next/image */}
            <img
              src={qr}
              alt={`QR code linking to ${member.displayName}'s MemberPass profile`}
              width={640}
              height={640}
              className="size-56"
            />
          </div>

          <div>
            <h2 className="type-h3">{member.displayName}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Opens your profile. Organizers still confirm attendance.
            </p>
          </div>

          <Link
            href={`/m/${member.slug}`}
            className={buttonVariants({ variant: 'secondary', className: 'w-full sm:w-auto' })}
          >
            Open public profile
          </Link>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Visible only while signed in. Don&apos;t post it.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
