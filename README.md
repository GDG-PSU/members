# GDG@PSU Members

Member identity, NFC cards, event attendance, points/stars and rewards for the
Google Developer Group at Penn State.

- **Hosted app:** <https://members-bay-eight.vercel.app>
- **Reader:** ESP32 + PN532 over **USB serial only**. No WiFi, server device API,
  registration, heartbeat, HMAC secret, kiosk polling, or writer-job polling.
- **Card writing:** sign in as an admin, open `/admin/usb`, prepare a pending
  card URL, connect the lane with Chrome/Edge Web Serial, write and read back the
  URL, then activate the card. If the reader is empty, the writer waits for a
  card before writing.
- **Attendance kiosk:** sign in as an admin, open `/admin/kiosk`, connect the
  same local lane, select an event session, choose **Read card**, and confirm
  check-in or check-out after checking the member's photo and identity. The
  kiosk keeps waiting until a card is placed; select **Cancel** to stop. The
  retired device registry is gone; `/admin/devices` redirects to `/admin/usb`.
- **No SMTP:** invitation and recovery links are generated in the admin UI and
  delivered manually.

## Current state

The production database was reset on **2026-11-04**. A one-time administrator
setup link for `sainaman@psu.edu` was written to
`.local/sainaman-admin-link.txt` (gitignored); it is not committed or printed.
The admin must set a password, then enroll TOTP at `/admin-mfa` before `/admin`
opens.

The browser build was verified against the hosted Supabase project with the
production build (`next start`) and the checks listed below. The latest code is
pushed; a Vercel deployment is not complete until the hosting deployment reports
ready.

## What the app includes

- Public home, leaderboard, events, and privacy-aware member profiles at
  `/m/<profile>`.
- Revocable card URLs at `/c/<token>`; a card URL is a public locator, never a
  login or an attendance credential.
- Invitation-first Supabase Auth, member setup, profile and privacy controls,
  digital ID QR, rewards/redemptions, and admin/MFA gates.
- Immutable points/stars ledger, staff-validated attendance records, audit log,
  private profile photos, and RLS-backed public projections.
- Admin card preparation/activation and attendance confirmation through the
  local USB lane at `/admin/usb` and `/admin/kiosk`.
- Legacy signed device routes and the old pending-scan endpoint remain for
  historical data only. They are not used by the USB firmware or the current
  kiosk UI. Do not register new WiFi lanes.

## Stack

- Next.js 16 App Router, React 19, strict TypeScript
- pnpm workspace + Turborepo
- Tailwind CSS v4 and the shared `@gdg/ui` component system
- Supabase Postgres, Auth and Storage; SQL migrations, RLS and
  `SECURITY DEFINER` functions
- ESP32/PN532 firmware with PlatformIO (Arduino framework)

## Quick start

Prerequisites: Node 20.9+ (24 used locally), pnpm 11, and a Supabase project.

```bash
pnpm install
cp .env.example .env.local   # fill in values; .env.local is gitignored
pnpm dev                     # http://localhost:3000
```

Set `NEXT_PUBLIC_SITE_URL` to `http://localhost:3000` for local testing and to
`https://members-bay-eight.vercel.app` for production-generated links. Use the
Supabase CLI or GitHub integration as the migration authority; do not mix the
legacy `pnpm db:migrate` history with a CLI-managed database.

### Environment variables

Names only; values stay in the environment or Vercel/Supabase dashboards.

| Variable                        | Notes                                                        |
| ------------------------------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_SITE_URL`          | Canonical origin for callbacks and one-time links            |
| `NEXT_PUBLIC_SUPPORT_EMAIL`     | Support address (`gdg@psu.edu`)                              |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL                                         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key; used by the RLS-bound server/browser client |
| `SUPABASE_SECRET_KEY`           | Server only; auth-admin and privileged operations            |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server-only legacy fallback                                  |
| `CARD_WRITE_ENCRYPTION_KEY`     | Server only; 32-byte base64 AES-GCM key                      |
| `DATABASE_URL`                  | Scripts and database verification only                       |

Never commit `.env*`, firmware secrets, recovery/invite links, or production
member data.

### First admin

The only production account created by the reset is the invited administrator.
To regenerate the setup link, run with the hosted origin and a gitignored output:

```bash
NEXT_PUBLIC_SITE_URL=https://members-bay-eight.vercel.app \
  pnpm db:bootstrap-admin --email sainaman@psu.edu \
  --out .local/sainaman-admin-link.txt
```

Deliver the file privately, then delete it. The link only sets a password; TOTP
enrollment at `/admin-mfa` is still required.

## Commands

| Command                   | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| `pnpm dev`                | Run the web app                                    |
| `pnpm build`              | Production build                                   |
| `pnpm typecheck`          | Strict TypeScript                                  |
| `pnpm lint`               | ESLint                                             |
| `pnpm test`               | Vitest unit tests                                  |
| `pnpm format:check`       | Prettier                                           |
| `pnpm db:verify`          | Rollback-safe database invariants and RLS checks   |
| `pnpm e2e`                | Playwright public and authenticated browser suites |
| `pnpm db:bootstrap-admin` | Grant admin and write a one-time recovery link     |
| `pnpm admin:enroll-totp`  | Enroll TOTP through the real `/admin-mfa` flow     |
| `pnpm verify`             | Available local gates; blocked gates fail visibly  |

Firmware:

```bash
cd firmware/kiosk-reader
pio run
pio run --target upload --upload-port COM3
pio device monitor -b 115200
```

Disconnect the PN532 while flashing if esptool loses COM3 during reset, then
reconnect it. The USB protocol is documented in [docs/usb-api.md](docs/usb-api.md);
wiring is in [docs/hardware-bringup.md](docs/hardware-bringup.md).

## Verification (2026-11-04)

- `pnpm format:check` — tested after final formatting
- `pnpm lint` — PASS
- `pnpm typecheck` — PASS
- `pnpm test` — PASS, 29/29
- `pnpm build` — PASS
- `pnpm e2e` — PASS, 19 passed / 1 intentionally skipped; includes invitation,
  member setup, USB card preparation/activation, and a fake-serial kiosk
  check-in/check-out with database assertions
- `pnpm db:verify` — PASS, 46/46
- Firmware compile — PASS, 304,129 bytes (23.2% flash)
- Physical PN532: card read/write/read-back PASS on COM3; firmware 2.0.0,
  protocol 2, device ID `esp32-3c1c6cc92df4`
- The final hosted-URI rewrite attempt returned `no_card` because the NTAG was
  not on the antenna; rerun the write after placing the tag on the reader
- Hosted `/`, `/leaderboard`, `/events`, `/privacy`, `/login` return 200; admin
  routes redirect anonymous visitors to `/login`

Not performed by the agent: a fresh Vercel deployment confirmation, a real
Chrome/Edge Web Serial session against this host, full TOTP sign-in on the hosted
origin, a hosted `/admin/kiosk` read/confirm, and a production card written for a
live member. Those remain browser and operator checks.

## Documentation

- [Architecture and trust boundaries](docs/architecture.md)
- [Data model](docs/data-model.md)
- [API and server actions](docs/api.md)
- [Threat model](docs/threat-model.md)
- [Deployment](docs/deployment.md)
- [Operations runbook](docs/operations-runbook.md)
- [Test plan and results](docs/test-plan.md)
- [Hardware bring-up](docs/hardware-bringup.md)
- [USB protocol](docs/usb-api.md)
- [Firmware README](firmware/kiosk-reader/README.md)

## Security highlights

- Points/stars are append-only ledgers; balances are sums, corrections are
  compensating entries.
- Card tokens are 256-bit, hashed for lookup, encrypted for owner-only display,
  and independently revocable. NFC UID and card URLs are never credentials.
- Public projections enforce profile, field and metric visibility server-side.
- Profile photos are re-encoded server-side and held in a private bucket.
- USB access trusts physical possession of the reader; the admin page still
  requires an admin/MFA session and card activation requires an explicit
  read-back attestation.
- Static NFC tags can be cloned. Staff must validate identity and attendance.

## License

[MIT](LICENSE) © Google Developer Group at Penn State.
