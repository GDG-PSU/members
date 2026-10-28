import type { Metadata } from 'next';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import { SUPPORT_EMAIL } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What GDG@PSU stores about members, who can see it, and how to change it.',
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
    <Container maxWidth="md" sx={{ py: { xs: 6, md: 9 } }}>
      <Typography variant="overline" color="primary">
        Plain language
      </Typography>
      <Typography variant="h1" sx={{ fontSize: { xs: '2.4rem', md: '3.4rem' }, mt: 1, mb: 2 }}>
        Privacy at GDG@PSU
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 5, maxWidth: 640 }}>
        This is a student community, not an advertising product. We collect what is needed to run
        membership, events and rewards.
      </Typography>
      <Stack spacing={3.5} divider={<Divider flexItem />}>
        {sections.map((section) => (
          <section key={section.title}>
            <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
              {section.title}
            </Typography>
            <Typography color="text.secondary">{section.body}</Typography>
          </section>
        ))}
      </Stack>
    </Container>
  );
}
