# Privacy notice

GDG@PSU is a student-run community at Penn State. This notice describes what the member portal stores and who can see it.

## What we collect

- **Account:** your email address (from your invitation) and authentication records managed by Supabase Auth. This application never stores your password.
- **Profile:** display name (required), profile photo (required), optional short bio and up to six `https://` links.
- **Membership:** member-since date, public member number, membership status and internal account identifiers.
- **Participation:** event attendance (check-in/check-out times, session, duration, qualification), points ledger and stars ledger, reward requests and redemptions.
- **Cards and devices:** card status and issuance/revocation events (never the printed card token in logs), plus organizer audit records of actions taken on your account.
- **Operational:** minimal device diagnostics (firmware version, last seen); no card UID is used as a credential.

Payment processing is out of scope. Do not send payment-card details to organizers for this system.

## Who can see it

- **Public (by default):** display name, photo, bio, links, member number, member-since date, points, stars and attended-event count — each toggleable. Profiles are public by default after setup. Your stable profile URL is `/m/<random-slug>`.
- **Leaderboard:** only if your profile is public and both points and leaderboard visibility are enabled. Hidden members are excluded, not shown as zero.
- **Email:** public by default. You can hide it during setup or at any time in Privacy settings.
- **Never public:** internal account identifiers, card token/hash, admin notes, invitations, device credentials, audit metadata and private attendance details beyond your visibility choices.
- **Organizers (admins):** member records, attendance, ledgers, card status and audit history, as needed to run events and resolve issues. Admin actions are audited. Admin access requires MFA.

## Your card

The NFC card stores only an HTTPS link (`/c/<opaque-token>`), which redirects to your profile. It contains no name, email, member number, points, password or device key. A card link is not a password: tapping it never checks you in, awards points, spends points or grants account access. Replacing a lost card revokes the old link without changing your profile URL.

## Your choices

- Hide any profile field, or make the entire profile private, at any time in **Member → Privacy**.
- Hide your email during setup or at any time in Privacy settings.
- Cancel a pending reward request; points are refunded through an audited ledger entry.
- Request a correction to attendance by emailing **gdg@psu.edu** from your registered address. Corrections require an organizer reason and are audited; history is not deleted, it is compensated.

## Retention and deletion

Attendance and ledger records are retained while your membership is active and for the period needed to resolve disputes. Archiving or suspending an account removes it from public views immediately but keeps records for dispute resolution. To close your account or correct your data, email **gdg@psu.edu** from your registered address; account deletion is a reviewed operator action because it also removes your ledger history.

## Contact

Privacy questions and data requests: **gdg@psu.edu**. Explain what you need and include your registered email so organizers can verify the request. This is a student organization, not a legal entity providing a regulated service; this notice is written to be honest and readable, not to create rights beyond applicable law.
