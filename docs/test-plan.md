# Test plan and recorded results

Last updated: 2026-10-28. A check is only marked **PASS** when it was run and its output inspected. Everything else is **NOT RUN** or **BLOCKED**, with the reason.

## Environment used

- Windows 11, Git Bash
- Node v24.3.0, pnpm 11.5.1, Git 2.56.0
- Supabase project `potjjlmgnrqxseeendmx` (hosted; Postgres via IPv4 pooler), publishable key configured, `gdg@psu.edu` bootstrapped as admin with TOTP enrolled
- Email delivery is manual (no SMTP; the app never sends mail)
- Authenticated E2E creates disposable Auth users and removes them (and their member rows, invitations and avatar objects) afterwards
- Docker Desktop installed; Supabase CLI and PlatformIO **not installed**
- No physical ESP32/PN532 hardware available

## Results summary

| Check | Command | Result |
| --- | --- | --- |
| Dependency install | `pnpm install` | PASS — completed and produced the lockfile. Warning: ignored build script `unrs-resolver@1.12.2`. |
| Migrations apply | `node scripts/db-migrate.mjs` | PASS — `0001_schema.sql` through `0004_rate_limits.sql`, then `0005_audit_actor_retention.sql`. 0005 drops the audit actor FK so deleting an account no longer collides with the append-only trigger; audit rows keep the actor UUID. |
| Database/RLS/domain checks | `node scripts/db-verify.mjs` | PASS — **38 passed, 0 failed**. |
| Typecheck | `pnpm typecheck` | PASS — web, ui and contracts (`tsc --noEmit`) |
| Lint | `pnpm lint` | PASS — ESLint clean |
| Unit tests (Vitest) | `pnpm test` | PASS — **23 passed** (token/crypto, NDEF-independent contracts, timezone conversion, limits) |
| Production build | `pnpm build` | PASS — Next.js 16 build, all routes; Turborepo build clean |
| Format check | `pnpm format:check` | NOT RUN |
| Playwright E2E (public smoke) | `E2E_BASE_URL=http://localhost:3000 pnpm e2e` | PASS — **16 passed** (desktop 1440 + Pixel 7): home, leaderboard, mobile overflow, theme toggle persistence, auth redirects, unknown card, device 401, public projection allowlist |
| Playwright authenticated invitation/setup | `E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test tests/e2e/admin-invitation.spec.ts --project=desktop-chromium` | PASS — disposable admin TOTP enrollment → invitation generation → link copy from the UI → separate member browser accepts → profile/photo/password setup → DB assertions; full suite **17 passed + 1 deliberate mobile skip**; fixtures removed |
| Admin TOTP enrollment (`gdg@psu.edu`) | `pnpm admin:enroll-totp` | PASS — AAL2 verified; a fresh password + TOTP sign-in reaches `/admin`; invitations page renders |
| Vercel preview deployment | `npx vercel deploy` | BLOCKED — no authenticated Vercel session; anonymous temporary deployments refused |
| Supabase Auth admin API | `/auth/v1/admin/users` | PASS after repair — legacy rows had NULL token columns, which made GoTrue fail every list/read; normalized to empty tokens, then list returned 200 |
| Admin bootstrap (`gdg@psu.edu`) | `node scripts/bootstrap-admin.mjs` | PASS — role granted; password sign-in 200; `admin/generate_link` 200 |
| Publishable-key login + AAL2 gate | Playwright (Chromium) against built app | PASS — admin signs in, lands on `/admin-mfa`; `/admin` and `/admin/invitations` redirect there; no client key errors |
| Generated recovery-link flow | Playwright against built app + hosted Auth | PASS — admin generate_link → verify → `/auth/callback` → session cookies → role-aware redirect → `/admin-mfa` |
| Accessibility (axe) | — | NOT RUN |
| Manual keyboard/visual review | — | NOT RUN |
| Load/concurrency API test | — | NOT RUN (concurrent redemption/locking at SQL level is covered below) |
| Dependency audit | `pnpm audit` | NOT RUN |
| Secret scan | gitleaks/trufflehog | NOT RUN |
| Firmware host parser tests | `g++ -Wall -Wextra -Werror` | PASS — `ndef_url: all checks passed (ok)` |
| Firmware compile (ESP32) | `pio run -d firmware/kiosk-reader` | BLOCKED — PlatformIO/toolchain not installed |
| Hardware-in-the-loop | actual PN532 + cards + network | BLOCKED — no hardware available; PSU network approval confirmed by the organizer |
| Live HTTP smoke | `curl` against built app | PASS — public routes 200; `/admin`, `/member` 307 → login; unsigned device heartbeat 401 |

## What `db-verify` proved

`scripts/db-verify.mjs` runs in a transaction that is rolled back (except a temporary concurrency user/reward that is cleaned up) and asserted:

- **Ledger:** grant is idempotent by `source_key`; one ledger row per key; positive grants create one mirrored star row; balances are ledger-derived; spending does not reduce stars.
- **Redemptions:** request returns an id; same idempotency key returns the same redemption; points debit; inventory decrements; out-of-stock and insufficient-points fail; a real second connection blocked on the member row lock after the first committed fails with `insufficient_points`; final balance is 0, never negative.
- **Attendance:** confirmed scan creates attendance; duplicate check-in rejected; checkout completes the record; 45-minute stay against a 30-minute threshold qualifies; reward snapshot stored; duration computed in minutes; points and stars granted once; a 5-minute stay against 30 minutes grants nothing and writes no ledger row; missing checkout grants zero; a bonus session is tracked independently of the main session.
- **Corrections:** reversal removes points and mirrored stars; append-only ledger rejects `UPDATE` with `append_only_relation`.
- **Cards:** activate sets status and issue time; preparing a new card replaces the prior active card with `revoked_at` set.
- **RLS:** a member reads only their own ledger/profile; cannot read another member's ledger or profile row; an admin reads all profiles; the public projection includes a public profile and excludes a private one; anonymous cannot read the ledger; `current_member_id()` resolves the signed-in member.

Not covered by `db-verify`: HTTP-layer authorization/IDOR, CSRF/origin checks, device authentication, rate-limiter thresholds, storage policies, admin MFA, UI behavior.

## Test layers and intended commands

### Static and unit

```bash
pnpm typecheck        # tsc --noEmit per package
pnpm lint             # ESLint (Next core-web-vitals + TypeScript)
pnpm format:check     # Prettier
pnpm test             # Vitest unit tests (when present)
pnpm build            # Next production build
```

Pure-logic tests still needed/expected: slug/token format and hashing, encrypted token round-trip, public projection visibility, links validation, `America/New_York` conversion, redemption math, NDEF URL parser.

### Database integration

```bash
# apply migrations to a clean database
DATABASE_URL="postgresql://…" pnpm db:migrate
# invariants and RLS
DATABASE_URL="postgresql://…" pnpm db:verify
```

Run against local/staging, not production: the script creates and removes a temporary concurrency fixture.

### End-to-end (Playwright) — PASS

Two specs run against the production build with Chromium:

- `tests/e2e/public.spec.ts` — home content/CTA, leaderboard, events at 375px with no horizontal overflow, System/Light/Dark toggle with reload persistence, anonymous redirects from `/member` and `/admin`, neutral unknown-card page, device-auth 401, and an allowlist assertion on public leaderboard JSON. **16/16 passed** (8 tests × desktop + mobile).
- `tests/e2e/admin-invitation.spec.ts` — creates a disposable admin via the Supabase admin API, signs in through `/login`, enrolls a real TOTP factor on `/admin-mfa`, generates an invitation, reads and copies the link from the link panel, then opens it in a separate browser context, sets name/photo/password, and asserts the invitation is `accepted` and the member/profile/private rows exist. Runs once on desktop (the mobile project deliberately skips it). Fixtures are deleted in a `finally` block.

Commands (built app running at the origin in `NEXT_PUBLIC_SITE_URL`):

```bash
E2E_BASE_URL=http://localhost:3000 pnpm e2e
# or only the authenticated spec
E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test tests/e2e/admin-invitation.spec.ts --project=desktop-chromium
```

`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) must be present; the spec skips with a message otherwise. Full-suite result: **17 passed + 1 deliberate mobile skip**.

The following still need a seeded staging environment and/or hardware, and are not automated yet:

1. Member edits bio/links/privacy; public page updates only enabled fields; email and QR never leak.
2. QR/ID only on authenticated `/member/id`; logged-out access redirects.
3. Prepare card → writer job claimed by the correct device → simulated read-back → card active; card-ready notice.
4. `/c/<token>` redirects to stable `/m/`; replacement revokes old token; old link shows neutral page.
5. Scan alone creates only a pending scan; admin-confirmed check-in/out below threshold grants nothing; at/over threshold grants exact points/stars.
6. Missing checkout and bonus session rules.
7. Leaderboard opt-outs/private profiles excluded and not inferable.
8. Redemption success, insufficient balance, concurrency, cancellation refund (stars unchanged).
9. Attendance correction requires reason and writes audit.
10. Forgot-password guidance and admin-generated recovery links work once; delivery is manual, so there is no mail-capture step.
11. Disabled device, bad secret, invalid/oversized payload, expired scan, duplicate idempotency, offline path fail safely.
12. Mobile/tablet/desktop at 320, 375, 768, 1024, 1440 with no horizontal overflow or lost actions (375 and 1440 are covered).

### Accessibility and visual checklist — NOT RUN

Automated theme/overflow checks passed; axe, screen-reader and zoom checks remain manual.

- axe-core on home, leaderboard, events, profile, login, setup, member dashboard, profile/privacy, rewards, ID, admin tables, kiosk.
- Keyboard-only: skip link, header/drawer, forms and validation, dialogs (focus trap/return), tabs, theme toggle.
- Screen-reader status announcements for save/success/error and kiosk confirmations.
- Contrast in both light and dark; no status conveyed by color alone.
- First visit defaults to System; OS preference changes follow in System mode; Light/Dark override; choice persists after reload; no hydration warning/flash.
- Reduced motion, zoom to 200%, 320px width.

### Load and concurrency — NOT RUN at API level

Simulate two lanes scanning simultaneously plus bursts of duplicate taps and concurrent redemptions; record latency, error rate and ledger correctness. The SQL transaction concurrency case is covered by `db-verify`.

### Firmware

Host parser test (pure C++ module, no Arduino dependency):

```bash
g++ -std=c++17 -I firmware/kiosk-reader/lib/ndef_url \
  firmware/kiosk-reader/lib/ndef_url/ndef_url.cpp \
  firmware/kiosk-reader/test/host/test_ndef_url.cpp \
  -o /tmp/test_ndef_url && /tmp/test_ndef_url
```

Compile check: `pio run -d firmware/kiosk-reader` (PlatformIO not installed here).

Hardware checklist (BLOCKED — approval confirmed, hardware not yet available): PN532 responds on the documented interface; a phone opens the exact written URL; reader parses it; writer writes, reads back and compares; locked/full tag fails clearly; two devices authenticate independently; disabling one blocks it; duplicate taps/retries/reboots/Wi-Fi loss do not award points; writer mode pauses attendance on that unit; deployed HTTPS works with certificate validation and the PSU-approved network.

## Security and operational checks

Not run yet: `pnpm audit`, lockfile review, secret scan over Git history, security-header inspection, CSRF/origin verification for cookie-authenticated mutations, log-redaction review, device-disable propagation test, backup/restore drill.

## Acceptance gate status

| Gate | Status |
| --- | --- |
| Clean migration from zero | PASS (hosted project, 0001–0005) |
| RLS/domain invariants | PASS (38 assertions) |
| Lint/typecheck/build | PASS (local) |
| Unit/component tests | PASS (23 unit tests) |
| Playwright E2E | PASS (17 passed + 1 mobile skip: public smoke + authenticated invitation/setup) |
| Accessibility/visual review | NOT RUN |
| Device API / firmware compile | API implemented and auth-tested; PlatformIO compile NOT RUN |
| Hardware-in-the-loop | BLOCKED (no hardware available) |
| Supabase configuration, admin bootstrap, publishable key | DONE (hosted project) |
| Vercel deployment, DNS | BLOCKED (no authenticated Vercel session; temporary deploys refused; DNS authorization) |
| Backup/restore drill | NOT RUN |

No production sign-off should be given until the unrun gates are executed or explicitly accepted with documented risk.
