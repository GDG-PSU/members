import type { Metadata } from 'next';
import { Card, PageShell } from '@gdg/ui';
import { SUPPORT_EMAIL } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What MemberPass stores about members, who can see it, and how to change it.',
};

const sections = [
  {
    title: 'What we store',
    body: 'Penn State email, name, photo, optional bio and links, membership date and number, attendance, points, stars, card status and organizer audit records.',
  },
  {
    title: 'What is public',
    body: 'Profiles and email are public by default. Each field can be hidden; a private profile hides them all. Account IDs and card tokens are never public.',
  },
  {
    title: 'Your card',
    body: 'The card stores only an opaque profile link — no name, email, points or credentials.',
  },
  {
    title: 'What organizers can see',
    body: 'Organizers see member, attendance, ledger, card and audit records. Access is role-gated and audited.',
  },
  {
    title: 'Changing or removing data',
    body: `Hide fields or go private in Member → Privacy. To close your account, email ${SUPPORT_EMAIL}. Corrections add an audited entry; history is never erased.`,
  },
  {
    title: 'Retention',
    body: 'Attendance and ledger records stay while you are a member and for dispute resolution. Archived accounts leave public views immediately.',
  },
];

export default function PrivacyPage() {
  return (
    <PageShell width="md" className="py-10 sm:py-14">
      <p className="type-overline text-primary">Plain language</p>
      <h1 className="type-h1 mt-2">Privacy at MemberPass</h1>
      <p className="mt-3 max-w-2xl text-[0.95rem] leading-relaxed text-muted-foreground">
        A student community, not an advertising product. We collect what membership needs.
      </p>

      <Card className="mt-8 divide-y divide-border overflow-hidden">
        {sections.map((section, index) => (
          <section key={section.title} className="p-5 sm:p-7">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h2 className="text-base font-bold sm:text-lg">{section.title}</h2>
            </div>
            <p className="mt-2 pl-7 text-sm leading-relaxed text-muted-foreground">
              {section.body}
            </p>
          </section>
        ))}
      </Card>

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Questions about your data? Email{' '}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="font-semibold text-primary underline-offset-2 hover:underline"
        >
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </PageShell>
  );
}
