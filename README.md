# GDG@PSU Members

Member identity, NFC card, event attendance, points/stars and rewards for the Google Developer Group at Penn State.

- Public site: home, leaderboard, events, permanent member profiles (`/m/<slug>`).
- Member portal: dashboard, activity, rewards/redemptions, profile editing, privacy controls, authenticated digital ID (QR).
- Backend: Supabase Postgres/Auth/Storage with transactional, ledger-derived points and append-only audit history.
- Firmware: ESP32 + PN532 reader/writer that talks only to a narrow HTTPS device API.

> **Status: hosted backend verified, production data reset to a clean slate, and one administrator (`sainaman@psu.edu`) created; not yet deployed.** All nine migrations, the private photo bucket, 46 database assertions and the browser suites pass. The administrator must still open their one-time link, set a password and enroll TOTP before `/admin` opens. Remaining operator steps are Vercel/DNS, production environment variables and hardware validation. Static NFC URLs can be cloned; staff must confirm attendance.

## Stack

- Next.js 16 App Router, React 19, strict TypeScript, Server Components + Server Actions
- pnpm workspace + Turborepo
- Tailwind CSS v4 + code-owned shadcn/ui-style components (Radix primitives, lucide icons), light/dark/system color schemes
- Supabase Postgres, Auth, Storage; SQL migrations, RLS, `SECURITY DEFINER` domain functions
- Zod contracts shared via `packages/contracts`
- ESP32/PN532 firmware with PlatformIO (Arduino framework)

## Current status

The table below reflects the hosted state verified on 2026-10-29. Re-run the release checks after any change.

| Area                                                                                                             | State                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Hosted Supabase migrations                                                                                       | All nine migrations applied to `potjjlmgnrqxseeendmx`; Supabase CLI-compatible history stamped for 0001–0009      |
| Database invariant/RLS verification (`db:verify`)                                                                | 46 assertions passed against the hosted project, including controlled erasure and the private bucket              |
| Public pages: `/`, `/leaderboard`, `/events`, `/events/[slug]`, `/m/[slug]`, `/c/[token]`, `/privacy`            | Implemented                                                                                                       |
| Auth: login, invite confirmation, one-time setup, password setting/recovery, sign out, password-help page        | Implemented                                                                                                       |
| Member portal: dashboard, activity, rewards + cancel, profile edit/photo, privacy toggles, digital ID QR         | Implemented                                                                                                       |
| Design system: Tailwind tokens, shadcn-style primitives, theme toggle (System/Light/Dark)                        | Implemented                                                                                                       |
| Audit log, rate-limit function, token hashing/encryption, server-side photo processing                           | Implemented                                                                                                       |
| ESP32/PN532 firmware project + host-testable NDEF parser                                                         | Compiled for esp32dev with example configuration; physical hardware untested                                      |
| Admin portal: invitations, members, cards, events, kiosk, rewards, devices, audit; TOTP MFA gate at `/admin-mfa` | Implemented; all surfaces exercised through the real UI in the full-surface run                                   |
| Device middleware API `/api/device/v1/*`                                                                         | Implemented; hardware flow untested                                                                               |
| Public JSON endpoints `/api/public/*`                                                                            | Implemented                                                                                                       |
| Publishable key wired into the SSR client; secret key limited to admin operations                                | Done                                                                                                              |
| Hosted first admin and MFA                                                                                       | `sainaman@psu.edu` created with an activation link; password + TOTP enrollment still required                     |
| Manual invitation/recovery links generated in the admin UI (no SMTP dependency)                                  | Implemented; links confirm at `/auth/confirm` on the app origin, independent of Supabase redirect allowlists      |
| PSU network approval for ESP32 lanes                                                                             | Not independently verified                                                                                        |
| License                                                                                                          | MIT                                                                                                               |
| Unit tests and browser tests                                                                                     | 25 unit tests; 19 Playwright checks (1 intentionally skipped) and a 34-step full-surface authenticated run passed |
| Admin bootstrap + guarded demo seed scripts, local `seed.sql`                                                    | Implemented                                                                                                       |

All test accounts, members, invitations, device and event rows, audit entries and profile photos were erased on 2026-10-29; only the production administrator remains. Hardware-in-the-loop testing, axe/manual accessibility review, the shared firmware signature vector, comprehensive secret scanning and a pgTAP matrix are still missing. `pnpm verify` exits nonzero because those gates are not implemented; it does not certify a release.

## Quick start

Prerequisites: Node 20.9+ (24 used locally), pnpm 11, and a Supabase project (hosted or local via the Supabase CLI/Docker).

```bash
pnpm install
cp .env.example .env.local   # fill in values; .env.local is gitignored
pnpm dlx supabase@2.122.0 start  # applies migrations to a local Supabase stack
pnpm db:verify               # optional: transactional invariants + RLS checks
pnpm dev                     # http://localhost:3000
```

Use the Supabase CLI or GitHub integration as the single migration authority. The legacy `pnpm db:migrate` uses separate history and must never be mixed with the CLI; it refuses databases with CLI migration history. `pnpm db:verify` needs `DATABASE_URL` and runs in a rolled-back transaction but creates/removes one temporary concurrency fixture; use local/staging.

### Environment variables

Copy [.env.example](.env.example). Names only:

| Variable                        | Notes                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`          | Canonical origin used for callbacks/links                                       |
| `NEXT_PUBLIC_SUPPORT_EMAIL`     | Support address (`gdg@psu.edu`)                                                 |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL (public)                                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key (`sb_publishable_…`); used by the SSR client and subject to RLS |
| `SUPABASE_SECRET_KEY`           | **Server only**; admin/auth-admin operations only, never `NEXT_PUBLIC_`         |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Server only**; legacy fallback                                                |
| `CARD_WRITE_ENCRYPTION_KEY`     | **Server only**; 32-byte base64 for AES-GCM card payloads                       |
| `DATABASE_URL`                  | Migration/verification scripts only                                             |

The publishable key backs the cookie-bound SSR client, so every user and anonymous query is subject to RLS. The secret key is used only by `createSupabaseAdmin()` for explicitly authorized admin operations (auth-admin link generation, cross-member reads, device jobs) and never reaches the browser.

### Admin bootstrap

There is no public admin signup. Create the admin's Supabase Auth user, then grant the role:

```sql
insert into public.user_roles (auth_user_id, role, note)
select id, 'admin', 'initial bootstrap'
from auth.users
where lower(email) = lower('REPLACE_WITH_REAL_ADMIN_EMAIL')
on conflict (auth_user_id, role) do update set revoked_at = null;
```

Or let the script create/find the Auth user and write a one-time recovery link:

```bash
pnpm db:bootstrap-admin --email you@psu.edu --out .local/admin-link.txt
```

The script prints no passwords or links: it writes a one-time recovery link to the `--out` file (gitignored under `.local/`). Deliver it privately and delete the file. The new admin must set a password and enroll an authenticator at `/admin-mfa` before `/admin` opens. Without SMTP there is no automatic email anywhere: invitation and recovery links are generated in the admin UI and copied by hand.

## Commands

| Command                             | Purpose                                                                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Run the web app                                                                                                                                                                     |
| `pnpm build`                        | Production build (Turborepo)                                                                                                                                                        |
| `pnpm typecheck`                    | Strict TypeScript across packages                                                                                                                                                   |
| `pnpm lint`                         | ESLint (Next core-web-vitals + TS)                                                                                                                                                  |
| `pnpm test`                         | Vitest unit tests (25)                                                                                                                                                              |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                                                                                                            |
| `pnpm db:migrate`                   | Legacy migration runner for its own databases only; use Supabase CLI for new environments                                                                                           |
| `pnpm db:verify`                    | Rollback-safe DB/RLS/ledger checks                                                                                                                                                  |
| `pnpm e2e`                          | Playwright public + authenticated invitation/setup suite (requires `pnpm e2e:install`, a running app and Supabase admin credentials; disposable fixtures are removed automatically) |
| `pnpm db:bootstrap-admin`           | Grant the admin role and write a one-time recovery link (`--out`) for an existing/new Auth user                                                                                     |
| `pnpm admin:enroll-totp`            | Enroll the admin authenticator through `/admin-mfa`; writes the manual key to a gitignored file without printing it                                                                 |
| `pnpm db:seed`                      | Guarded, fictional local demo fixtures (`SEED_CONFIRM=yes SEED_ALLOWED=1`)                                                                                                          |

Firmware host parser test (no hardware, no PlatformIO):

```bash
g++ -std=c++17 -Wall -Wextra -Werror \
  -I firmware/kiosk-reader/lib/ndef_url \
  firmware/kiosk-reader/test/host/test_ndef_url.cpp \
  firmware/kiosk-reader/lib/ndef_url/ndef_url.cpp \
  -o /tmp/ndef_test && /tmp/ndef_test
```

Firmware compile: `pio run -d firmware/kiosk-reader` (PlatformIO not installed in this environment).

## Repository layout

```text
apps/web/                 Next.js app (public, auth, member routes; API + server actions)
  src/app/(public)/       Home, leaderboard, events, /m/, /c/, privacy
  src/app/(auth)/         Login, invite setup, callback page, recovery guidance
  src/app/(member)/       Dashboard, activity, rewards, profile, privacy, digital ID
  src/app/(admin)/admin/  Dashboard, invitations, members, events, kiosk, cards, rewards, devices, audit
  src/app/api/            Public JSON, admin kiosk, device v1, auth routes
  src/lib/                Supabase clients, auth viewer, tokens/crypto, photo pipeline, API helpers
tests/e2e/                Playwright public + authenticated invitation/setup suite
packages/ui/              Tailwind tokens + shadcn-style primitives and branded components (PageShell, MetricCard, …)
packages/contracts/       Zod schemas/types for profiles, events, rewards, devices
supabase/migrations/      Schema, RLS, functions, storage, rate limits
scripts/                  Migration runner, DB verification, admin bootstrap, guarded seed
firmware/kiosk-reader/    PlatformIO ESP32/PN532 project (lib/, src/, test/host/)
docs/                     Architecture, data model, API, threat model, deployment, runbooks
```

## Security highlights

- Points/stars are append-only ledgers; balances are sums. Corrections are compensating entries, never edits.
- `grant_points`, `redeem_reward`, `confirm_scan` and card functions are `SECURITY DEFINER`, `search_path = ''`, granted only to `service_role`; the server authorizes the actor first.
- A scan creates only a pending row; attendance requires admin-confirmed check-in **and** check-out with a threshold.
- Card tokens are 256-bit, hashed for lookup, encrypted for owner-only display/write; NFC UID is never a credential.
- Public data uses explicit projection views; email is public by default and can be hidden during setup or later.
- Photos are validated/re-encoded server-side (2 MB, JPEG/PNG/WebP) and stored under random paths.
- Security headers (CSP, nosniff, referrer policy, frame denial) are configured in `apps/web/next.config.ts`.

Details: [docs/threat-model.md](docs/threat-model.md), [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md).

## Testing

Recorded on 2026-10-29 against hosted Supabase and the production build (`next start`):

- `pnpm format:check` — PASS
- `pnpm lint` — PASS
- `pnpm typecheck` — PASS (web, ui, contracts)
- `pnpm test` — PASS, **25/25** unit tests
- `pnpm build` — PASS (Next.js production build, all routes)
- `pnpm db:verify` — PASS, **46/46** database assertions (ledger, concurrency, attendance, privacy, RLS, MFA, erasure, private bucket)
- `pnpm e2e` — 19 passed, 1 intentionally skipped (mobile admin spec)
- Full-surface authenticated run — 34/34 checks: every admin page, member invitation/setup, admin invitation → password → TOTP gate, points, events, card redirect/revoke, kiosk scan confirmation, rewards, suspension, privacy, device registration, audit and fixture cleanup
- Recovery-link password flow — verified with a disposable user; the new password then signed in successfully
- Firmware NDEF parser host test — PASS. Firmware compile was unavailable in the final environment (no PlatformIO on PATH and no local `secrets.h`).
- Live HTTP smoke: `/`, `/leaderboard`, `/events`, `/privacy`, `/login` return 200; `/admin` and `/member` redirect to login; unsigned device heartbeat returns 401

Not run: axe-core/manual screen-reader review, load test, comprehensive secret scan, pgTAP matrix, shared firmware signature vector, hardware-in-the-loop, Vercel preview. See [docs/test-plan.md](docs/test-plan.md).

## External blockers (need a human/organization)

1. **Vercel:** authenticate the CLI, import the repository, set the production/preview environment variables from `docs/deployment.md`, and set `NEXT_PUBLIC_SITE_URL` to the final public origin before generating new links.
2. **DNS:** authorize `member.gdgpsu.dev` (or use the Vercel production domain) and point `NEXT_PUBLIC_SITE_URL` at it. App-generated links use `/auth/confirm`, so no Supabase redirect allowlist entry is required for them.
3. **Admin activation:** `sainaman@psu.edu` must open the one-time link, set a password, then enroll TOTP at `/admin-mfa`. The link expires per the Supabase Email OTP setting; regenerate it with `pnpm db:bootstrap-admin --email sainaman@psu.edu --out .local/admin-link.txt` after setting the production site URL.
4. **Hardware:** provide the exact PN532 boards, writable NFC tags, USB access and an event environment for two-lane testing, and obtain PSU network approval and the correct SSID/EAP settings.

## Documentation

- [Architecture and trust boundaries](docs/architecture.md)
- [Data model](docs/data-model.md)
- [API and server actions](docs/api.md)
- [Threat model + ASVS mapping](docs/threat-model.md)
- [Deployment](docs/deployment.md)
- [Operations runbook](docs/operations-runbook.md)
- [Backup and restore](docs/backup-restore.md)
- [Test plan and results](docs/test-plan.md)
- [Hardware bring-up](docs/hardware-bringup.md) · [PSU network validation](docs/psu-network-validation.md)
- [Firmware README](firmware/kiosk-reader/README.md)
- [ADR: stack and boundaries](docs/adr/0001-stack-and-boundaries.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md)

## License

[MIT](LICENSE) © Google Developer Group at Penn State.
