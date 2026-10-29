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
    body: 'Your Penn State email (public by default), display name, profile photo, optional bio and links, membership-since date, membership number, event attendance, points and stars, card status and audit records of organizer actions.',
  },
  {
    title: 'What is public',
    body: 'Profiles are public by default. Name, photo, bio, links, member number, member-since date, points, stars and attended-event count can each be hidden independently. Email is public by default and can be hidden at any time. Your internal account identifier and card token never appear publicly.',
  },
  {
    title: 'Your card',
    body: 'The NFC card stores only an HTTPS link to an opaque card URL, which redirects to your profile. It contains no name, email, member number or points. A card is not a password and never authorizes a check-in, purchase or account change.',
  },
  {
    title: 'What organizers can see',
    body: 'Organizers can see member records, attendance, ledger entries, card status and audit history in order to run events and resolve issues. Access is role-gated on the server and actions are audited.',
  },
  {
    title: 'Changing or removing data',
    body: `You can hide fields or make your entire profile private at any time in Member → Privacy. To close your account or correct your data, email ${SUPPORT_EMAIL} from your registered address. Attendance corrections never delete ledger history; they add an audited compensating entry.`,
  },
  {
    title: 'Retention',
    body: 'Attendance and ledger records are retained while your membership is active and for the period needed to resolve disputes. Archived accounts are removed from public views immediately.',
  },
];

export default function PrivacyPage() {
  return (
    <PageShell width="md" className="py-10 sm:py-14">
      <p className="type-overline text-primary">Plain language</p>
      <h1 className="type-h1 mt-2">Privacy at MemberPass</h1>
      <p className="mt-3 max-w-2xl text-[0.95rem] leading-relaxed text-muted-foreground">
        MemberPass is the member portal for GDG@PSU. This is a student community, not an advertising
        product. We collect what is needed to run membership, events and rewards.
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
