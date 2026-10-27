# GDG@PSU Members

Member identity, NFC card, event attendance, points/stars and rewards for the Google Developer Group at Penn State.

- Public site: home, leaderboard, events, permanent member profiles (`/m/<slug>`).
- Member portal: dashboard, activity, rewards/redemptions, profile editing, privacy controls, authenticated digital ID (QR).
- Backend: Supabase Postgres/Auth/Storage with transactional, ledger-derived points and append-only audit history.
- Firmware: ESP32 + PN532 reader/writer that talks only to a narrow HTTPS device API.

> **Status: feature-complete locally, not a production sign-off.** Public, auth, member, admin/kiosk, card-writer, device API and firmware slices are implemented and the production build, unit tests, Playwright smoke suite and database checks pass. Still blocked on external items: Vercel/Supabase deployment, production SMTP, custom domain, a real admin identity, PSU network approval and physical hardware. See [Current status](#current-status) and [docs/test-plan.md](docs/test-plan.md).

## Stack

- Next.js 16 App Router, React 19, strict TypeScript, Server Components + Server Actions
- pnpm workspace + Turborepo
- MUI v9 theme/primitives, light/dark/system color schemes
- Supabase Postgres, Auth, Storage; SQL migrations, RLS, `SECURITY DEFINER` domain functions
- Zod contracts shared via `packages/contracts`
- ESP32/PN532 firmware with PlatformIO (Arduino framework)

## Current status

As of 2026-10-27.

| Area | State |
| --- | --- |
| Migrations 0001–0004 applied to the hosted Supabase project | Done |
| Database invariant/RLS verification (`db:verify`) | **38 passed, 0 failed** |
| Public pages: `/`, `/leaderboard`, `/events`, `/events/[slug]`, `/m/[slug]`, `/c/[token]`, `/privacy` | Implemented |
| Auth: login, invite callback, one-time setup, sign out, password-help page | Implemented |
| Member portal: dashboard, activity, rewards + cancel, profile edit/photo, privacy toggles, digital ID QR | Implemented |
| Design system: MUI theme, primitives, theme toggle (System/Light/Dark) | Implemented |
| Audit log, rate-limit function, token hashing/encryption, server-side photo processing | Implemented |
| ESP32/PN532 firmware project + host-testable NDEF parser | Present; not compiled or hardware-tested |
| Admin portal: invitations, members, cards, events, kiosk, rewards, devices, audit; TOTP MFA gate at `/admin-mfa` | Implemented; not exercised with a real admin account yet |
| Device middleware API `/api/device/v1/*` | Implemented; hardware flow untested |
| Public JSON endpoints `/api/public/*` | Implemented |
| Unit tests (23), Playwright smoke suite (16 across desktop/mobile), CI workflow | Implemented and passing locally |
| Admin bootstrap + guarded demo seed scripts, local `seed.sql` | Implemented |

Hardware-in-the-loop, production SMTP delivery, admin MFA enrollment and authenticated admin/member Playwright flows remain unverified. Treat the platform as ready for staging, not for live member data.

## Quick start

Prerequisites: Node 20.9+ (24 used locally), pnpm 11, and a Supabase project (hosted or local via the Supabase CLI/Docker).

```bash
pnpm install
cp .env.example .env.local   # fill in values; .env.local is gitignored
pnpm db:migrate              # applies supabase/migrations/*.sql (or: supabase db push)
pnpm db:verify               # optional: transactional invariants + RLS checks
pnpm dev                     # http://localhost:3000
```

`pnpm db:migrate` needs `DATABASE_URL` (use the Supabase pooler URL if direct IPv6 is unavailable). `pnpm db:verify` runs in a rolled-back transaction but creates/removes one temporary concurrency fixture; use local/staging.

### Environment variables

Copy [.env.example](.env.example). Names only:

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin used for callbacks/links |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Support address (`gdg@psu.edu`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional today; recommended for hardening |
| `SUPABASE_SECRET_KEY` | **Server only**; never `NEXT_PUBLIC_` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only**; legacy fallback |
| `CARD_WRITE_ENCRYPTION_KEY` | **Server only**; 32-byte base64 for AES-GCM card payloads |
| `DATABASE_URL` | Migration/verification scripts only |

The supplied Supabase project has no publishable key, so the app uses the secret key server-side via `@supabase/ssr`. It never reaches the browser. Signed-in requests still use the user JWT, so RLS applies. Add a publishable key and switch `createSupabaseServer()` when available — see [docs/architecture.md](docs/architecture.md).

### Admin bootstrap

There is no public admin signup. Create the admin's Supabase Auth user, then grant the role:

```sql
insert into public.user_roles (auth_user_id, role, note)
select id, 'admin', 'initial bootstrap'
from auth.users
where lower(email) = lower('REPLACE_WITH_REAL_ADMIN_EMAIL')
on conflict (auth_user_id, role) do update set revoked_at = null;
```

Or let the script create/find the Auth user and send a recovery email:

```bash
pnpm db:bootstrap-admin --email you@psu.edu
```

The script prints no passwords. The new admin must enroll an authenticator at `/admin-mfa` before `/admin` opens.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the web app |
| `pnpm build` | Production build (Turborepo) |
| `pnpm typecheck` | Strict TypeScript across packages |
| `pnpm lint` | ESLint (Next core-web-vitals + TS) |
| `pnpm test` | Vitest unit tests (23) |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm db:migrate` | Apply SQL migrations in order |
| `pnpm db:verify` | Rollback-safe DB/RLS/ledger checks |
| `pnpm e2e` | Playwright public smoke suite (requires `pnpm e2e:install` and a running app) |
| `pnpm db:bootstrap-admin` | Grant the admin role + send recovery email for an existing/new Auth user |
| `pnpm db:seed` | Guarded, fictional local demo fixtures (`SEED_CONFIRM=yes SEED_ALLOWED=1`) |

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
tests/e2e/                Playwright public smoke suite
packages/ui/              MUI theme/tokens + branded primitives (PageShell, MetricCard, …)
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
- Public data uses explicit projection views; email is private by default.
- Photos are validated/re-encoded server-side (2 MB, JPEG/PNG/WebP) and stored under random paths.
- Security headers (CSP, nosniff, referrer policy, frame denial) are configured in `apps/web/next.config.ts`.

Details: [docs/threat-model.md](docs/threat-model.md), [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md).

## Testing

Recorded on 2026-10-27:

- `pnpm typecheck` — PASS (web, ui, contracts)
- `pnpm lint` — PASS
- `pnpm test` — PASS, **23/23** unit tests
- `pnpm build` — PASS (Next.js production build, all routes)
- `node scripts/db-verify.mjs` — PASS, **38/38** database assertions
- Playwright against the built app — PASS, **16/16** across desktop + mobile viewports
- Firmware NDEF parser host test — PASS (`g++ -Wall -Wextra -Werror`)
- Live HTTP smoke: `/`, `/leaderboard`, `/events`, `/privacy`, `/login` return 200; `/admin` and `/member` redirect to login; unsigned device heartbeat returns 401

Not run: axe-core, manual screen-reader review, load test, dependency audit, secret scan, PlatformIO compile, hardware-in-the-loop, authenticated admin/member Playwright flows (need a real admin account + SMTP). See [docs/test-plan.md](docs/test-plan.md).

## External blockers (need a human/organization)

1. **Vercel + production Supabase publishable key:** authorize a Vercel project and provide a publishable key (or approve switching to one) so the web tier no longer needs the secret key.
2. **SMTP:** choose and authorize a transactional email provider; verify sender domain (SPF/DKIM/DMARC) and configure Supabase Auth templates.
3. **DNS:** authorize `member.gdgpsu.dev` and add `https://member.gdgpsu.dev/auth/callback` to the Supabase redirect allowlist.
4. **Admin identity:** provide the real admin email for role bootstrap and require TOTP enrollment.
5. **PSU network:** obtain PSU IT approval for ESP32 access (approved SSID/EAP or dedicated network). Do not use personal credentials or bypass TLS/captive controls.
6. **Hardware:** provide the exact PN532 boards, writable NFC tags, USB access and an event environment for two-lane testing.
7. **License:** choose a license with the organization's approval before distributing the repository.

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

No license has been chosen. Per the project plan, pick a license with the organization's approval before distributing or accepting outside contributions.
