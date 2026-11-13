# Deployment

Next.js on **Vercel** at **https://members.gdgpsu.dev**, with Supabase for
Postgres, Auth and Storage. The project's Vercel addresses,
`mempass.vercel.app` and `members-bay-eight.vercel.app`, redirect to that domain.
The card readers need no network of their own.

The hosted Supabase project is `potjjlmgnrqxseeendmx`. A push to `main` deploys
the app and, through the Supabase GitHub integration, applies any new file in
`supabase/migrations/`. The two finish at different speeds, so for a few minutes
one runs without the other. When the old app cannot run on the new schema, or
the new app on the old one, push the schema first, confirm it applied, then push
the app. The app expects every migration in that folder.

## 1. Vercel project

| Setting          | Value                                          |
| ---------------- | ---------------------------------------------- |
| Root             | repository root                                |
| Install          | `pnpm install --frozen-lockfile`               |
| Build            | `pnpm --filter @gdg/web build`                 |
| Node             | 20.9+ (24 used locally)                        |
| Framework preset | Next.js                                        |
| Output           | `apps/web/.next` (configured in `vercel.json`) |
| Production URL   | `https://members.gdgpsu.dev`                   |

`NEXT_PUBLIC_SITE_URL` must equal the hosted origin for production. Preview
deployments should use their own origin and must not point at the production
database with real member data.

## 2. Environment variables (names only)

Set in Vercel → Project → Settings → Environment Variables for Production and
Preview separately. Never commit values.

| Name                            | Exposure       | Purpose                                                          |
| ------------------------------- | -------------- | ---------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`          | Public         | The site's origin: one-time links and card links are built on it |
| `NEXT_PUBLIC_SUPPORT_EMAIL`     | Public         | Support address (`gdg@psu.edu`)                                  |
| `NEXT_PUBLIC_SUPABASE_URL`      | Public         | Supabase project URL                                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public         | Publishable key for the RLS-bound client                         |
| `SUPABASE_SECRET_KEY`           | Server only    | Auth-admin and privileged operations                             |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server only    | Legacy fallback if no secret key                                 |
| `CARD_WRITE_ENCRYPTION_KEY`     | Server only    | 32-byte base64 key that seals stored card links and reader keys  |
| `DATABASE_URL`                  | Server/CI only | Migration/verification scripts only                              |

The app validates required values at startup and fails closed. Preview must use
a staging database or stay read-only; do not expose production member data.

Changing `CARD_WRITE_ENCRYPTION_KEY` makes every stored card link and reader
key unreadable: members' digital IDs stop showing their card, and every reader
has to be erased, flashed and provisioned again.

## 3. Supabase Auth

These are dashboard settings on the hosted project. `supabase/config.toml` only
configures the local stack, so check them here; the Auth settings endpoint reports
the sign-up state as `disable_signup`.

- Site URL: `https://members.gdgpsu.dev`; keep it in sync with
  `NEXT_PUBLIC_SITE_URL`.
- Optional callback fallback: `https://members.gdgpsu.dev/auth/callback`.
- **Allow new users to sign up: off.** Accounts are created by Admin API invitation
  or recovery links, which keep working with sign-ups off.
- Minimum password length 12, requiring letters and digits, matching the app.
- Leaked password protection on, where the plan offers it.
- Organizer pages need a session verified with an authenticator app. A new
  organizer sets a password and then sets the authenticator up at `/admin-mfa`.
- No SMTP is configured. An organizer makes a one-time link on the People page
  and sends it from their own mailbox; password reset links work the same way.
- Those links open `/auth/confirm` on the app's own origin, so no Supabase
  redirect allowlist entry is needed. Opening one only shows a Continue button,
  so chat previews and mail scanners cannot use it up.

## 4. Production reset and first superadmin

A person runs these, never an agent. `pnpm db:reset` permanently removes every
Auth user, session and authenticator, all application rows including the audit log
and invitation history, the rate limit counters, and every profile photo. The
schema and migration history stay. It is not a backup: take one first if anything
in the database matters.

The scripts read the root `.env.local`, so check which project it points at. With
no arguments, the reset only reports the target project and what it holds:

```bash
pnpm db:reset
```

To erase it, pass the project ref that the dry run printed:

```bash
pnpm db:reset --confirm <project-ref>
```

The reset removes your own account too, so create the first superadmin next. The
one-time link goes to a gitignored `.local/` file and is never printed:

```bash
pnpm db:bootstrap-admin --email <you>@psu.edu --role superadmin --site-url https://members.gdgpsu.dev --out .local/superadmin-link.txt
```

The link works once, for 72 hours. Open it, press Continue, set a password, enroll TOTP at
`/admin-mfa`, set up the profile your card will open, and confirm the hosted admin
dashboard opens. Delete the file afterward, and do not send the
link through this repository or chat.

## 5. Card readers

A reader works only for this site's signed-in organizers, because the site holds
its key. Each reader is set up once, by whoever flashes it:

```bash
pio run -d firmware/kiosk-reader --target upload --upload-port COM3
python firmware/kiosk-reader/tools/provision_reader.py --port COM3 --confirm potjjlmgnrqxseeendmx
```

The second command needs the production `NEXT_PUBLIC_SUPABASE_URL`, a service
key and `CARD_WRITE_ENCRYPTION_KEY` in the environment or the root
`.env.local`. It writes one row to `reader_keys` and one audit entry. Run it
only after the site is on the version that matches the firmware: older pages
would give a reader with no key one the current pages cannot use.

There is nothing else to register. `docs/hardware-bringup.md` covers wiring and
checking a reader, and `docs/operations-runbook.md` how organizers use one.

## 6. After a deploy

1. `/`, `/leaderboard`, `/events`, `/privacy` and `/login` return 200.
2. `/admin` and `/admin/cards` send a signed-out visitor to `/login`.
3. An organizer can sign in with their authenticator. A new one's authenticator
   entry is named after the production host.
4. A link made on the People page starts with `https://members.gdgpsu.dev` and
   its path is `/auth/confirm`.
5. On `/admin/cards`, **Connect reader** shows the reader connected, and
   **Reader tools** shows its firmware and that Bluetooth is ready.
6. A card written for a test person reads back, and its link opens their
   profile. Switch it off and the link shows the neutral unavailable page.
7. A superadmin sees the audit log and the manage pages; a normal admin does
   not.

## 7. Rolling back

- Vercel can redeploy the previous build from its dashboard.
- A migration is not rolled back: fix forward with a new one, and never delete
  points or attendance rows to do it.
- If a deploy breaks sign-in, check `NEXT_PUBLIC_SITE_URL` and the Auth Site URL
  first. One-time links are built on the site's origin, so make new ones after
  the origin changes.
- If a secret was exposed, rotate it in Supabase and Vercel, then redeploy.
