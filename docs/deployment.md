# Deployment

Target: Next.js on **Vercel** at
**https://mempass.vercel.app**, Supabase Postgres/Auth/Storage, and a
USB-only ESP32 + PN532 reader. No custom domain, DNS change, campus WiFi, or
firmware server endpoint is required.

The hosted Supabase project is `potjjlmgnrqxseeendmx`. Compare its applied
migrations with `supabase/migrations/` before a release: the application expects
every migration in that folder, through `0014_security_hardening.sql`. Verify the
Vercel deployment after a push before treating a checkout as the running release.

## 1. Vercel project

| Setting          | Value                                          |
| ---------------- | ---------------------------------------------- |
| Root             | repository root                                |
| Install          | `pnpm install --frozen-lockfile`               |
| Build            | `pnpm --filter @gdg/web build`                 |
| Node             | 20.9+ (24 used locally)                        |
| Framework preset | Next.js                                        |
| Output           | `apps/web/.next` (configured in `vercel.json`) |
| Production URL   | `https://mempass.vercel.app`                   |

`NEXT_PUBLIC_SITE_URL` must equal the hosted origin for production. Preview
deployments should use their own origin and must not point at the production
database with real member data.

## 2. Environment variables (names only)

Set in Vercel → Project → Settings → Environment Variables for Production and
Preview separately. Never commit values.

| Name                            | Exposure       | Purpose                                                        |
| ------------------------------- | -------------- | -------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`          | Public         | Canonical origin for `/auth/confirm` links                     |
| `NEXT_PUBLIC_SUPPORT_EMAIL`     | Public         | Support address (`gdg@psu.edu`)                                |
| `NEXT_PUBLIC_SUPABASE_URL`      | Public         | Supabase project URL                                           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public         | Publishable key for the RLS-bound client                       |
| `SUPABASE_SECRET_KEY`           | Server only    | Auth-admin and privileged operations                           |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server only    | Legacy fallback if no secret key                               |
| `CARD_WRITE_ENCRYPTION_KEY`     | Server only    | 32-byte base64 AES-GCM key; rotation invalidates stored tokens |
| `DATABASE_URL`                  | Server/CI only | Migration/verification scripts only                            |

The app validates required values at startup and fails closed. Preview must use
a staging database or stay read-only; do not expose production member data.

## 3. Supabase Auth

These are dashboard settings on the hosted project. `supabase/config.toml` only
configures the local stack, so check them here; the Auth settings endpoint reports
the sign-up state as `disable_signup`.

- Site URL: `https://mempass.vercel.app`; keep it in sync with
  `NEXT_PUBLIC_SITE_URL`.
- Optional callback fallback: `https://mempass.vercel.app/auth/callback`.
- **Allow new users to sign up: off.** Accounts are created by Admin API invitation
  or recovery links, which keep working with sign-ups off.
- Minimum password length 12, requiring letters and digits, matching the app.
- Leaked password protection on, where the plan offers it.
- Admin routes require AAL2. The invited administrator must set a password and
  enroll TOTP at `/admin-mfa`.
- No SMTP is configured. Admin → Invitations generates a one-time link; the
  admin copies it into their own mailbox. The same applies to recovery links.
- Generated links confirm at `/auth/confirm` on the app origin, so no Supabase
  redirect allowlist entry is needed for them.

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
pnpm db:bootstrap-admin --email <you>@psu.edu --role superadmin --site-url https://mempass.vercel.app --out .local/superadmin-link.txt
```

The link works once and expires with the project's OTP window, so generate it when
it will be used. Open it, set a password, enroll TOTP at `/admin-mfa`, and confirm
the hosted admin dashboard opens. Delete the file afterward, and do not send the
link through this repository or chat.

## 5. USB reader deployment

1. Wire the PN532 to the ESP32 exactly as in `docs/hardware-bringup.md`.
2. Build and flash from `firmware/kiosk-reader`; disconnect the PN532 only if
   esptool loses the serial port during reset.
3. In Chrome or Edge on the hosted admin origin, sign in with AAL2 and open
   `/admin/cards`.
4. Prepare a card URL, connect the lane with Web Serial, write it, verify the
   read-back, and activate it.
5. There is no device registration, WiFi onboarding, certificate, or PSU network
   approval step for this reader.
6. For attendance, open `/admin/kiosk`, choose the event session, connect the
   lane, read a card, verify the member and photo, and confirm check-in or
   check-out. A read is only a preview; it never changes attendance by itself.

Do not expose the serial port through a network proxy. Physical USB access can
issue the same local commands; the admin/MFA session protects the web page, not
the serial bus.

## 6. Post-deploy verification

1. `/`, `/leaderboard`, `/events`, `/privacy` and `/login` return 200.
2. `/admin` and `/admin/cards` redirect anonymous visitors to `/login`.
3. The invited admin can set a password and complete TOTP at `/admin-mfa`.
4. Admin → Invitations generates a link whose origin is
   `https://mempass.vercel.app` and whose path is `/auth/confirm`.
5. `/admin/cards` lists active members; preparing a card returns a `/c/<43-char>`
   URL and activation changes the card to active.
6. A physical tag writes and reads back the same URL in Chrome/Edge.
7. `/c/<active-token>` redirects to the member profile; revoked/unknown tokens
   land on the neutral unavailable page.
8. A superadmin sees **Users** and **Audit** and can choose Admin or Superadmin
   in the staff invite form. A normal admin sees neither tab and gets no staff
   invite form.

## 7. Rollback

- Promote the previous Vercel deployment.
- Migrations are forward-only; restore a dump into a disposable project to
  investigate and write a corrective migration. Do not delete ledger or
  attendance rows.
- Rotate Supabase/Vercel secrets if exposed, then redeploy.
- Generated invitation and recovery links are one-time; reissue them after a
  domain or origin change.
