# Deployment

Target: Next.js on **Vercel** at
**https://members-bay-eight.vercel.app**, Supabase Postgres/Auth/Storage, and a
USB-only ESP32 + PN532 reader. No custom domain, DNS change, campus WiFi, or
firmware server endpoint is required.

The hosted Supabase project is `potjjlmgnrqxseeendmx`; migrations 0001–0010 are
applied. The database was reset on 2026-11-04 and one administrator setup link
was generated for `sainaman@psu.edu`. Hosting is live and the latest source has
been pushed; verify the Vercel deployment after the push before treating this
checkout as the running release.

## 1. Vercel project

| Setting          | Value                                          |
| ---------------- | ---------------------------------------------- |
| Root             | repository root                                |
| Install          | `pnpm install --frozen-lockfile`               |
| Build            | `pnpm --filter @gdg/web build`                 |
| Node             | 20.9+ (24 used locally)                        |
| Framework preset | Next.js                                        |
| Output           | `apps/web/.next` (configured in `vercel.json`) |
| Production URL   | `https://members-bay-eight.vercel.app`         |

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

- Site URL: `https://members-bay-eight.vercel.app`; keep it in sync with
  `NEXT_PUBLIC_SITE_URL`.
- Optional callback fallback: `https://members-bay-eight.vercel.app/auth/callback`.
- Keep public signup disabled. Accounts are created by Admin API invitation or
  recovery links.
- Admin routes require AAL2. The invited administrator must set a password and
  enroll TOTP at `/admin-mfa`.
- No SMTP is configured. Admin → Invitations generates a one-time link; the
  admin copies it into their own mailbox. The same applies to recovery links.
- Generated links confirm at `/auth/confirm` on the app origin, so no Supabase
  redirect allowlist entry is needed for them.

## 4. Production reset and admin invite

The reset removes all application rows, Auth users, and profile photos, then
creates only the `sainaman@psu.edu` Auth user with the admin role. The one-time
link is written to a gitignored `.local/` file; it is never printed or committed.

```bash
NEXT_PUBLIC_SITE_URL=https://members-bay-eight.vercel.app \
  pnpm db:bootstrap-admin --email sainaman@psu.edu \
  --out .local/sainaman-admin-link.txt
```

Set a password from the link, then enroll TOTP at `/admin-mfa` and confirm the
hosted admin dashboard. Do not send the link through this repository or chat.

## 5. USB reader deployment

1. Wire the PN532 to the ESP32 exactly as in `docs/hardware-bringup.md`.
2. Build and flash from `firmware/kiosk-reader`; disconnect the PN532 only if
   esptool loses the serial port during reset.
3. In Chrome or Edge on the hosted admin origin, sign in with AAL2 and open
   `/admin/usb`.
4. Prepare a card URL, connect the lane with Web Serial, write it, verify the
   read-back, and activate it.
5. There is no device registration, WiFi onboarding, certificate, or PSU network
   approval step for this reader.

Do not expose the serial port through a network proxy. Physical USB access can
issue the same local commands; the admin/MFA session protects the web page, not
the serial bus.

## 6. Post-deploy verification

1. `/`, `/leaderboard`, `/events`, `/privacy` and `/login` return 200.
2. `/admin` and `/admin/usb` redirect anonymous visitors to `/login`.
3. The invited admin can set a password and complete TOTP at `/admin-mfa`.
4. Admin → Invitations generates a link whose origin is
   `https://members-bay-eight.vercel.app` and whose path is `/auth/confirm`.
5. `/admin/usb` lists active members; preparing a card returns a `/c/<43-char>`
   URL and activation changes the card to active.
6. A physical tag writes and reads back the same URL in Chrome/Edge.
7. `/c/<active-token>` redirects to the member profile; revoked/unknown tokens
   land on the neutral unavailable page.

## 7. Rollback

- Promote the previous Vercel deployment.
- Migrations are forward-only; restore a dump into a disposable project to
  investigate and write a corrective migration. Do not delete ledger or
  attendance rows.
- Rotate Supabase/Vercel secrets if exposed, then redeploy.
- Generated invitation and recovery links are one-time; reissue them after a
  domain or origin change.
