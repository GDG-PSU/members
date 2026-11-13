# Security policy

## Reporting a vulnerability

Email **gdg@psu.edu** with a description, steps to reproduce and the impact. Do
not open a public issue for a suspected vulnerability, and do not include other
members' data or live credentials in the report.

This is a student-run project with no formal response time. Organizers
acknowledge reports as soon as they can and coordinate a fix before anything is
made public.

Only the current `main` branch is supported.

## The security model in brief

- **Identity:** Supabase Auth, email and password. Accounts exist by invitation
  only; there is no public sign-up. Organizers also verify an authenticator app.
- **Authorization:** every page, server action and route handler checks the
  session and the role on the server. Roles come from `user_roles`, never from
  metadata or an email address. Member data is also protected by Postgres RLS.
- **Points and stars:** append-only ledgers; a balance is a sum. Grants,
  reversals and reward requests run in SQL functions only the server can call,
  with idempotency keys and row locks.
- **Attendance:** reading a card, scanning a QR code or finding a member by name
  only creates a preview. An organizer checks the person against their photo and
  confirms.
- **Cards:** a card holds one opaque HTTPS link and can be copied, so holding
  one authorizes nothing. Links are stored hashed, with a sealed copy for the
  owner's own digital ID.
- **Card readers:** a reader holds a key of its own and obeys only a session
  opened with it, over its cable or over Bluetooth. The site stores that key
  sealed and never gives it to a browser for a session: the server answers the
  handshake for a signed-in organizer and returns a key for that one session,
  under which every line is sealed with AES-256-GCM. See `docs/usb-api.md`,
  including what this does not protect against.
- **One-time links:** invitations and password resets are links the app issues
  itself. Only the token's hash is stored, a link works once, for 72 or 48
  hours, and opening one does not spend it.
- **Public data:** explicit projections with per-field visibility enforced in
  the database. Internal IDs, card data and notes are never public.
- **Audit:** an append-only log with the actor and reason. Nothing can update or
  delete an entry, and it never holds a secret, a card link or a one-time link.
- **Secrets:** the Supabase service key, the encryption key and the database
  URL live in ignored env files and in the host's settings. Nothing secret is
  prefixed `NEXT_PUBLIC_` or compiled into the reader's firmware.
- **Headers:** a CSP, `X-Content-Type-Options`, `Referrer-Policy`, framing
  denial and a permissions policy, in `apps/web/next.config.ts`.

## Handling secrets

1. Never commit `.env*` (except `.env.example`), service keys, card links,
   one-time links, reader keys or real member data.
2. Never prefix a secret with `NEXT_PUBLIC_`.
3. Never put a Supabase key on a reader.
4. Do not paste secrets into chats, issues, screenshots or test reports.
5. When a reader comes back after being out of your hands, use **Rotate key**
   before trusting it.

## Known limits

- The server holds a service key for organizer operations, so a server
  compromise is high impact.
- A one-time link is as sensitive as a password until it is used, and it is
  delivered by hand.
- A reader's flash is not encrypted. Someone with the reader and a flashing tool
  can read its key or replace its firmware.
- Email is public on a profile unless the member hides it.
- The public read APIs have no rate limit, and no load test has been run.
- No secret scanning or dependency audit runs in CI, and no backup restore has
  been rehearsed.

`docs/threat-model.md` has the full threat table, and `docs/test-plan.md` what
has and has not been tested.
