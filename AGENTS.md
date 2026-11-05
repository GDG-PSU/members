# AGENTS.md

**This is the living operating manual for agents changing this repository.** Read it before you
start. If your change touches architecture, routes, authentication, the database, commands, tests,
deployment, or conventions, update the relevant section **in the same change**. Before you finish,
re-read the affected sections and amend anything this file now gets wrong. Add new gotchas when you
find them. `PLAN.md` and `PROMPT.md` are retired; do not recreate them.

`README.md` is the overview for people, and `docs/` is the deep reference. This file is the
operational source of truth for how to work here, and section 13 holds the project's current state
and progress. If this file and the code disagree, inspect the code and migrations, fix this file, and
call out the discrepancy.

## 1. What this repository is

GDG@PSU's invitation-only member platform: member identity and profiles, NFC membership cards,
event attendance, points/stars, rewards, and organizer administration.

Current hardware is **USB-only**. An admin browser talks to an ESP32 + PN532 reader over Web Serial;
the reader has no WiFi, server client, secret, registration, heartbeat, or writer-job queue. The old
WiFi device API is legacy and must not be revived as part of normal work. See
`docs/architecture.md` and `docs/usb-api.md`.

## 2. Workspace map

| Path                        | Responsibility                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                  | The deployable Next.js app: App Router pages, server actions, route handlers, auth, queries, and UI composition.      |
| `packages/ui`               | Shared Tailwind v4 design tokens, primitives, and branded components. This is the only UI kit.                        |
| `packages/contracts`        | Framework-neutral Zod schemas and shared public types. Validate request/data boundaries here when practical.          |
| `supabase/migrations`       | Schema, RLS, grants, views, storage policy, and transactional domain functions. This is the database source of truth. |
| `scripts`                   | Verification, legacy migration, seed, reset, admin bootstrap, and TOTP enrollment entry points.                       |
| `tests/e2e`                 | Playwright public and authenticated browser tests, including disposable fixtures.                                     |
| `firmware/kiosk-reader`     | PlatformIO ESP32/PN532 USB firmware. No network or secret handling.                                                   |
| `docs`                      | Architecture, data model, API, USB protocol, operations, deployment, security, hardware, and test records.            |
| Root `README.md`            | Plain-language overview and quick start for people. Status, test results, and agent rules belong in this file.        |
| `CONTRIBUTING.md`           | Human contribution rules; the commit rules below still apply to agents.                                               |
| `SECURITY.md`, `PRIVACY.md` | Security reporting and data-handling expectations.                                                                    |

## 3. Current architecture and trust boundaries

```text
Member/admin browser
  -> Next.js App Router on Vercel
       -> Supabase Auth (email + password, invitation/recovery links)
       -> Postgres (RLS + SECURITY DEFINER functions)
       -> Supabase Storage (`avatars`, server-side uploads)

Admin browser (AAL2)
  -> USB serial -> ESP32 + PN532
       -> /admin/cards  (prepare/write/read back/activate)
       -> /admin/kiosk  (read -> preview -> human confirmation)
       -> server actions/API -> Next.js -> Supabase
```

- The browser holds an HttpOnly Supabase session cookie (`supabaseCookieOptions`), never the
  service key. There is no browser Supabase client; adding one would require changing this.
- User-scoped reads use the cookie-bound Supabase client so Postgres RLS is exercised. Public
  projections and cross-member reads may use the server-only admin client, but only after the
  query is deliberately scoped to explicit public columns.
- The publishable key is public, and PostgREST exposes everything in `public` that an API role can
  reach. API roles get only what RLS needs: `anon` can read published events; `authenticated` can
  also read its own rows and call the three RLS helpers (`is_admin`, `is_superadmin`,
  `current_member_id`). Everything else, including the public projections, is `service_role` only.
- `createSupabaseAdmin()` is server-only and must appear only after an authorization check. Never
  import it into client code.
- Privileged writes happen only on the server. Domain transitions use the existing SQL functions
  where they exist; do not reimplement ledger, attendance, card, reward, or role transitions in
  TypeScript. Direct profile/privacy updates still go through the service-role client only after
  `requireMember` has resolved the caller's own member row.
- Public data comes from explicit views/projections: `public_profiles`, `leaderboard`, and explicit
  event columns. Never serialize a base table row or an Auth user to the public.
- Serverless functions are stateless. Rate limits and locks live in Postgres; there are no
  long-lived jobs, in-memory locks, or background daemons.
- USB reads are local previews. They never grant points or complete attendance by themselves.

### Legacy surfaces: do not build on them

Retained for historical records/tests but **not** the current hardware flow:

- `/api/device/v1/*` signed device endpoints
- `/api/admin/kiosk/pending` polling
- writer jobs and card write queues
- `lib/devices/*` signature/auth helpers and the `devices`/`card_write_jobs` tables
- `/admin/usb` and `/admin/devices`

`/admin/usb` and `/admin/devices` redirect to `/admin/cards`; do not add new links to them. Do not
add WiFi, device secrets, heartbeat, registration, or writer-job behavior to the current USB flow
without an explicit product decision.

## 4. Roles and access control

- **Member** — own profile, card, activity, points, and rewards. Invitation-only; there is no public
  sign-up.
- **Admin** — invitations, revoking member access, cards, events, kiosk, and rewards. Normal admins
  see only the invitations and activity they created (they can still see all members); they do not
  get staff-role management, the member detail page and its actions, or the full audit log.
- **Superadmin** — inherits admin operations, manages staff roles/invitations, reads the full audit
  log, and owns the member detail actions: status changes, interaction points, attendance
  corrections, and recovery links. A recovery link is a password reset for whoever holds it, so it
  must stay superadmin-only. The last active superadmin cannot be revoked or demoted (enforced by the
  `user_roles_keep_last_superadmin` trigger), and self-revocation is blocked.

User types are exclusive: member, admin, or superadmin, enforced by `set_user_type`. Staff also
have a row in `members`, with `kind = 'organizer'`, because the profile and the card hang off that
table. An organizer row is a profile and a card holder only: it never earns or spends points, has
attendance, or appears on the leaderboard, and triggers on the ledgers, attendance and redemptions
refuse one. So:

- `viewer.member` is set for members only. `viewer.profile` is anyone's own profile; use
  `requireProfile` to edit it.
- A query that means paying members must filter `kind = 'member'`.
- A new staff account sets up its profile at `/admin-setup` after TOTP, and the admin layout sends
  an organizer without a profile there.
- Promoting a member keeps their profile and card, and deletes their points, attendance and reward
  requests. Demoting staff turns their profile back into a member's when it has a photo. Without
  one, the profile is removed and they get a member setup invitation with
  `requires_password = false`.
- Revoking staff access archives the organizer row, which switches off the profile and the card;
  inviting them again restores it.

Treat type changes as deliberate, audited operations.

Admin pages and privileged database policies require **AAL2** (TOTP). Page guards are not enough on
their own: route handlers and server actions must re-check the viewer and role.

- Use `requireMember`, `requireProfile`, `requireAdmin`, or `requireSuperadmin` for pages/actions.
- Use `getApiViewer`/the API guard for route handlers, then check `isAdmin`/`isSuperadmin`.
- Roles live in `user_roles`; never trust `user_metadata`, a client-supplied role, or client-side
  visibility.
- Invitations and recovery links are generated manually through Supabase Auth. There is no SMTP or
  email provider. The admin copies the one-time link; it is a secret.
- Staff invitation state is derived from the `admin.invited` audit event plus the **absence** of
  `auth.password_updated`. Do **not** use `last_sign_in_at` or `encrypted_password` for this; they
  are unreliable and previously caused accepted invitations to look pending.

## 5. Route map

| Surface    | Routes                                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public     | `/`, `/leaderboard`, `/events`, `/events/[slug]`, `/m/[profileSlug]`, `/c/[cardToken]`, `/card-unavailable`, `/privacy`                                                                               |
| Auth       | `/login`, `/forgot-password`, `/account/password`, `/account-suspended`, `/invite/accept`, `/auth/callback`, `/auth/confirm`, `/admin-mfa`, `/admin-setup`                                            |
| Member     | `/member`, `/member/activity`, `/member/id`, `/member/profile`, `/member/privacy`, `/member/rewards`                                                                                                  |
| Admin      | `/admin`, `/admin/profile`, `/admin/invitations`, `/admin/users`, `/admin/cards`, `/admin/kiosk`, `/admin/events`, `/admin/events/new`, `/admin/events/[id]`, `/admin/rewards`, `/admin/rewards/[id]` |
| Superadmin | `/admin/audit`, `/admin/members/[id]` (and staff-role controls within `/admin/users`)                                                                                                                 |

Canonical aliases/redirects:

- `/admin/devices` -> `/admin/cards`
- `/admin/usb` -> `/admin/cards`
- `/admin/members` -> `/admin/users`

APIs and handlers:

- `/api/auth/session` and `/api/auth/signout`
- `/api/admin/kiosk/confirm`
- `/api/profile-photo/[slug]` (authorization-aware photo delivery)
- `/api/public/events`, `/api/public/events/[slug]`, `/api/public/leaderboard`
- `/c/[cardToken]` (redirect-only card locator)

`/c/<token>` is a revocable routing identifier, not an authentication credential. Cards are
cloneable; never use a card tap as proof of identity or authorization.

## 6. Domain invariants

### Identity, profiles, and privacy

- Membership starts only through an invitation and atomic `complete_member_setup`.
- A member's profile requires a face photo before it can be saved, because the kiosk checks the
  person against it. An organizer's photo is optional. Photos are validated, metadata-stripped,
  cropped, and re-encoded server-side (`normalizeProfilePhoto`), which reads the real format from the
  file; never trust the filename or client MIME type.
- Only serve photos through the authorization-aware endpoint. Do not expose storage paths or raw
  bucket URLs.
- Public profiles are opt-out by field; the database projection nulls hidden fields. Never build a
  public profile by taking a base row and deleting fields in the browser.
- Profile links are `https://` only and capped at six. Do not add `javascript:`, `data:`, or plain
  HTTP links.
- `photo_changed_at` inside the last 48 hours makes the photo an unverified identity claim. The
  kiosk must ask for a PSU ID and the server must reject confirmation without `identityCheck`.

### Points, stars, and rewards

- `point_ledger` and `star_ledger` are append-only. Triggers reject ordinary `UPDATE`/`DELETE`.
- Balances are always sums via views or transactional queries; there is no mutable balance column.
- Every grant needs a unique `source_key`; retries must be idempotent.
- Corrections are compensating entries with an actor and reason. Never delete or rewrite history.
  A source key can only be spent once, so attendance grants use `attendance_grant_key`, which issues
  a new key after a reversal. Reusing the old key silently awards nothing.
- Stars are lifetime and non-spendable. Positive point grants mirror equal stars; spends do not
  touch stars; reversals mirror negative stars. The leaderboard ranks by stars, so redeeming a
  reward never lowers a rank.
- Redemptions are transactional and idempotent. A repeated idempotency key returns the same
  redemption. Cancellation/rejection refunds and restocks inventory.
- Preserve reward/cost snapshots on ledgers, attendance, and redemptions. Do not make historical
  amounts follow later edits.

### Attendance

1. The kiosk identifies a member by a card read, the QR code on their digital ID, or an organizer
   finding them by name or GDG number. Each creates only a short-lived pending preview.
2. A human admin verifies the person and confirms check-in.
3. Check-out requires a later identification and confirmation.
4. Points are granted only on confirmed check-out when the duration meets the session minimum and
   the session reward is positive. The event form sets no minimum: late arrivals are cut off by
   `check_in_closes_at` and early leavers by `check_out_opens_at`.
5. Duplicate check-in/check-out, missing check-in, expired scans, out-of-window scans, and duplicate
   session attendance must fail with stable, human-readable errors.
6. Corrections go through the audited correction path, not direct table edits.

Neither a QR code nor a name proves who is present any more than a card does, so the photo check,
the 48-hour PSU ID rule, and the confirmation apply to all three. `attendance_records` records the
method of each step in `check_in_method` and `check_out_method` (`card`, `qr`, `manual`).

An organizer fills in the event's times, its points, and two attendance rules. The four check-in and
check-out times on each session are derived from those in `lib/events/attendance-rules.ts`; do not
add them back to the form. A new event is a draft, its web address comes from its name and never
changes afterwards, and a published event counts as ended once its end time passes.

Attendance is unique per `(member, session)`. Bonus sessions have their own attendance row. All
instants are stored as `timestamptz`; event wall-clock input and display use
`America/New_York` helpers.

### Cards

- `prepare_card` creates a pending credential; the admin writes the URL over USB and verifies the
  read-back before activation.
- At most one active card per member. The old card keeps working until `activate_card` replaces it,
  so an abandoned write never strands a member. A lost card is revoked explicitly.
- Only the SHA-256 lookup hash and an encrypted token copy are stored. Never persist or log a
  plaintext card token or a full card URL.
- Revocation is explicit and audited. Unknown/revoked/replaced tokens go to the neutral
  `/card-unavailable` page with no member metadata.

### Audit and rate limits

- Audit rows are append-only and outlive account erasure. Never log secrets, card tokens, one-time
  invitation/recovery links, unnecessary email addresses, or profile content; record which fields
  changed, not their values.
- Rate limits are Postgres-backed. Use `withinRateLimit` (`consume_rate_limit`); do not add
  per-instance memory limits in serverless code. Hash client addresses and emails into bucket names
  with `hashForBucket`. Do not key a limit on an unauthenticated, attacker-chosen value: each new
  value adds a row.

## 7. Commands and verification

Prerequisites: Node **>= 20.9**, pnpm **11.5.1** (see `packageManager`), and the committed
lockfile. CI uses Node 24. Install dependencies with `pnpm install --frozen-lockfile`.

### Web development

```bash
pnpm dev
# Deterministic local port on this Windows environment:
PORT=3000 pnpm --filter @gdg/web dev
```

`pnpm dev` runs Turborepo -> Next 16. A native `next dev` may inherit an existing `PORT` (we have
seen a random high port); use the filtered command when a fixed origin matters.

### Required checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test          # all workspace unit tests
pnpm test:unit     # @gdg/web Vitest only
pnpm build
pnpm verify        # orchestration + firmware build + audit
```

`pnpm verify` currently always exits nonzero because the **complete release coverage** gate is
intentionally blocked (missing pgTAP/API/accessibility/visual/secret-scanning gates). Report it as
blocked, not as a pass. It also runs `pnpm audit` and the firmware build.

### Database

The migration authority is the Supabase CLI/GitHub integration, with
`supabase/migrations/` as the source of truth. Do not edit a hosted schema by hand, and do not mix
migration runners.

- `pnpm db:verify` — privilege, transactional invariant, and RLS checks; requires `DATABASE_URL`. It
  is intended for a disposable local/staging database and refuses a non-local host unless
  `DB_VERIFY_ALLOW_HOSTED=yes`. Concurrency checks can leave temporary rows, so **do not run it
  against production**.
- `pnpm db:migrate` — **legacy**. It records a separate history and refuses a database that already
  has CLI migration history. Do not use it on the hosted project and do not run it alongside the
  CLI.
- `pnpm db:seed` — guarded demo/local seed. Check the script's guard before running; never seed
  production.
- `pnpm db:reset` — permanently empties Auth, every `public` table including the audit log, and the
  `avatars` bucket; the schema stays. It is a dry run unless given `--confirm <project-ref>`. On
  production a person runs it, never an agent. See `docs/deployment.md`.
- `pnpm db:bootstrap-admin` and `pnpm admin:enroll-totp` — operator-only. Do not paste generated
  links, secrets, or TOTP material into chat or logs. Bootstrap takes `--role admin|superadmin`
  (default `admin`) and `--site-url <origin>`, and writes the link only to `--out`.
- Add new schema as a new numbered migration; never edit an already-applied migration. Use
  `SECURITY DEFINER`, `set search_path = ''`, schema-qualified names, and explicit grants. Since
  0014, new functions and tables in `public` start closed to `anon` and `authenticated`, so grant
  only what RLS needs. A migration cannot rely on `revoke ... from public` to remove API access.

### Browser tests

`pnpm e2e` runs Playwright against a server you start separately; the config does **not** start
Next. It loads `.env.local` and `apps/web/.env.local`, and the base URL is the first available of
`E2E_BASE_URL`, `NEXT_PUBLIC_SITE_URL`, then `http://localhost:3100`.

- Public specs can run against a normal local build.
- The authenticated admin spec runs when `NEXT_PUBLIC_SUPABASE_URL` and a Supabase service key are
  present; card/device specs also need `CARD_WRITE_ENCRYPTION_KEY`. It creates/removes disposable
  fixtures. Run it against a disposable/test database, not production, and verify no leftover E2E
  auth users or rows. It skips on a hosted `*.supabase.co` project unless
  `E2E_ALLOW_HOSTED_SUPABASE=yes`; never set that for production.
- `workflows.spec.ts` drives every member and organizer workflow through the real UI with a fake
  Web Serial port. To run it locally, start the stack with
  `pnpm dlx supabase@2.122.0 start -x realtime,edge-runtime,imgproxy,studio,postgres-meta,logflare,vector,supavisor`,
  export its URL and keys in the shell (process env wins over `.env.local`), then build and serve the
  app on the `E2E_BASE_URL` port. `NEXT_PUBLIC_*` values are inlined at build time, so rebuild
  whenever you switch databases.
- The invitation regression test intentionally checks `admin.invited` plus absence of
  `auth.password_updated`; do not "simplify" it back to `last_sign_in_at`.
- For a focused run, pass the spec path and one project:
  `pnpm e2e tests/e2e/admin-invitation.spec.ts --project=desktop-chromium`.
- Install Chromium with `pnpm e2e:install`.

### Firmware

```bash
pio run -d firmware/kiosk-reader
pio run -d firmware/kiosk-reader --target upload --upload-port COM3
pio device monitor -b 115200
```

The firmware build is also part of `pnpm verify`. `docs/hardware-bringup.md` records what has passed
on physical hardware and what has not; claim only what it lists. Unplug the PN532 before an upload on
the current reader, or esptool loses the port. Bump `GDG_FIRMWARE_VERSION` in `platformio.ini` with
any firmware change, since `info` reports it to the admin page.

### CI

`.github/workflows/ci.yml` runs format checking, lint, typecheck, unit tests, and build with
placeholder env. It does **not** run E2E, database verification, firmware, or dependency audit. Do
not assume CI covers those.

## 8. Code conventions

- Strict TypeScript, no `any`, no non-null assertions to silence real uncertainty. Use the `@/`
  alias inside `apps/web`.
- Put server-only modules behind `import 'server-only'` when they touch secrets or privileged
  clients.
- Validate external input with Zod at the boundary (`@gdg/contracts` where the shape is shared).
  Return user-safe errors; log server details without secrets.
- API handlers use the shared `jsonOk`/`jsonError`/`handleApiError` helpers and a request ID.
  Private responses must not be cached.
- Server actions must re-check authorization, validate input, perform the domain mutation, write
  the relevant audit entry, and `revalidatePath` affected surfaces. An exported action is a public
  endpoint whether or not a page uses it: match the role of the page that renders it, and delete it
  when nothing does.
- Server actions get a built-in origin check; route handlers do not. A cookie-authenticated or
  session-setting route handler must call `isSameOriginRequest`.
- Read user-scoped data with the cookie-bound client so RLS is tested. Use the admin client only
  for explicit public projections or cross-member operations after authorization.
- Render with `@gdg/ui` primitives and the existing token layer. Do not introduce a second design
  system or hard-code brand colors. Preserve light/dark behavior and accessible labels.
- A `useActionState` form that users type into takes `onReset={keepValuesOnError(state)}`. React 19
  clears a form after every action, including one that failed validation.
- Server actions for such a form return `{ error }` rather than redirecting with the error, which
  would drop what was typed.
- Sign out with `signOut({ scope: 'local' })`. The default is global, which ends every device's
  session.
- A sign-in may continue to the page the person was opening only through `safeReturnPath`, which
  accepts plain paths inside their own area.
- Use the existing date helpers; do not hand-roll timezone conversion. Event inputs are
  `America/New_York`; storage is UTC.
- Keep comments focused on non-obvious reasons and invariants, not restatements of the code.
- Run Prettier on TypeScript/JSON/Markdown you touch. SQL and firmware sources have their own
  conventions; do not mass-format them.

## 9. Git and commit policy

This is mandatory.

**Work directly on `main`.** Do not create a feature branch or open a pull request unless the user
asks for one.

1. Inspect `git status --short`, `git diff`, and, when staged, `git diff --cached`. Stage only files
   related to the current task.
2. Do not commit `.env*` (except the template), `.local/`, `.next/`, `node_modules/`, coverage,
   Playwright reports/test results, logs, or generated build artifacts.
3. `next dev` can rewrite `apps/web/next-env.d.ts` with development type references. That drift is
   not part of a feature; restore the tracked version before staging.
4. Use concise, imperative commit subjects. Explain **why** in the body when the change is not
   obvious.

**No AI-agent attribution.** Commits must look like normal human commits from the repository's
configured identity:

- no "Generated with ..." lines;
- no `Co-Authored-By` trailers for agents or tools;
- no agent names, "AI", robot emoji, or fabricated authors;
- no `--author` override to impersonate someone else.

Try the normal configured commit first:

```bash
git commit -m "Imperative subject"
```

If the commit **hangs at the signing step** (or fails only because a GPG/SSH signing agent or
passphrase is unavailable), cancel it and retry the same commit with:

```bash
git commit --no-gpg-sign -m "Imperative subject"
```

Do not change global `commit.gpgsign`, do not rewrite history, and do not strip signing from
unrelated commits. If the normal commit succeeds, keep it signed.

Push only when the user asks. Do not force-push or amend published commits without explicit
permission.

## 10. Nits and gotchas

- Shell paths containing route-group parentheses must be quoted, e.g.
  `"apps/web/src/app/(admin)/admin/users/page.tsx"`.
- `NEXT_PUBLIC_SITE_URL` must match the origin you actually use. It drives generated invitation,
  recovery, and card links; a mismatch causes confusing auth/link failures.
- The repository is public. Keep the details of an unfixed vulnerability out of commits, pull
  requests, and docs until the fix is live.
- The card route's nested embed (`members!inner(... member_profiles!inner(...))`) is intentional:
  there is no direct foreign key from `card_credentials` to `member_profiles`. Do not "simplify" it
  back into a failing embed.
- `/admin/usb` and `/admin/devices` are aliases, not current destinations. `/admin/cards` is the
  canonical card surface; `/admin/kiosk` is attendance.
- `pnpm verify` is not green because its final coverage gate is deliberately blocked. Do not report
  it as a pass.
- `pnpm db:verify` can leave temporary concurrency rows even though the main checks roll back. It is
  not a production command.
- Some docs still describe the retired WiFi/device/writer-job flow or lag the migration list. Treat
  current code and migrations as authoritative, and update the legacy sections when you touch them.
- E2E admin tests can create real Auth users and database fixtures. Always verify cleanup and never
  point them at production.
- Prettier may ignore SQL/firmware files; that is deliberate. Do not reformat those trees as a
  drive-by change.
- The environment may inject `PORT`; use `PORT=3000 pnpm --filter @gdg/web dev` when the site URL
  or E2E callback depends on port 3000.
- On Supabase, `revoke ... from public` removes nothing from `anon`/`authenticated`: its default ACL
  grants them directly. Check with `has_function_privilege`, or `get_advisors`, not by reading SQL.
- Next reads `apps/web/.env.local`; the scripts read `.env.local` in the root. A fresh setup needs
  both.
- `.env.local` in this checkout points at the hosted production project. Scripts and specs that
  write must be pointed elsewhere with `DATABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL`.
- Hosted Auth settings are not in `supabase/config.toml`, which only configures the local stack. See
  `docs/deployment.md` for what production must have.
- The proxy must cover every route that renders the root layout. A Server Component cannot write
  cookies, so a token refresh elsewhere is lost and the replayed refresh token ends the session. A
  proxy redirect must copy the refreshed cookies for the same reason.
- `.maybeSingle()` yields `null` plus an error when more than one row matches. When a filter can
  match several rows, add `.limit(1)`; an unchecked error looks like "no row".
- `raise exception` in PL/pgSQL rolls back earlier statements in the function, so updating a status
  and then raising records nothing.
- RLS on `member_profiles` hides a suspended member's profile from themselves, so viewer queries must
  not inner-join it to `members`.
- In `supabase/config.toml`, `[auth.email] enable_signup = false` turns off the email provider rather
  than just sign-up, and that breaks local sign-in. Local sign-up is closed at `[auth]` instead.
- A local Docker volume can sit at an older migration, which makes `pnpm db:verify` fail falsely.
  Run `pnpm dlx supabase@2.122.0 migration up --local` before trusting a failure.
- A password change ends the user's other sessions, so tests and flows must sign in again afterward.
- A page load must never spend a one-time token. Chat previews and mail scanners fetch a link as soon
  as it is shared, which used to burn invitations within seconds. `/auth/confirm` only shows a button;
  its server action calls `verifyOtp`.
- `mfa.enroll` without `issuer` names the authenticator entry after the hosted Auth Site URL, so the
  app passes the `SITE_URL` hostname. Entries already scanned keep their old name until renamed in the
  authenticator app.
- `apps/web/tsconfig.json` includes the generated `.next/dev/types`, so after removing a route a stale
  folder fails `pnpm typecheck` and a local `next build` with a missing `route.js`. Regenerate it with
  `next dev` or clear it; Vercel builds from a clean tree.
- The kiosk reads continuously while the reader is connected. A card stays "on the reader" until a
  read reports `no_card` (`waitForCardRemoved`), so it is never read twice; a test must lift the
  fake card before placing the next one.
- `flex-1` on a fixed-height control inside a column flex container replaces its height with the
  content height. It made the kiosk confirm button 18px tall.
- `Permissions-Policy` is fixed when a document loads and client-side navigation keeps it, so the
  camera the kiosk uses for QR codes is allowed site-wide, not per route.
- The app and the migrations deploy from the same push at different speeds, so for a few minutes
  one runs without the other. When the old app cannot run on the new schema, or the new app on the
  old one, split it: push the part the running app tolerates, confirm it applied, then push the rest.
- A browser tab connected over Web Serial holds the COM port, so flashing or a serial script gets
  "Access is denied" until the tab disconnects.

## 11. Definition of done

Before you report completion:

- [ ] The change is limited to the request; no speculative features or unrelated refactors.
- [ ] The smallest relevant checks were run, and their actual results are reported.
- [ ] New behavior has a focused test when it changes logic, authorization, or a user-critical flow.
- [ ] No test was skipped, weakened, or deleted just to make a check pass.
- [ ] Secrets, one-time links, tokens, and private data are absent from code, logs, and the diff.
- [ ] `AGENTS.md` and any affected docs are updated in the same change.
- [ ] `git status` shows only intentional source/docs changes and no generated drift.
- [ ] The commit, if requested, follows the policy in section 9.

## 12. Self-reiteration rule

This file is not a one-time artifact. Whenever a change alters a route, command, script, env var,
role, schema/migration, external service, test setup, deployment step, or convention, update this
file **in that same change**. If you discover a new failure mode, add a short gotcha. If you remove
a legacy surface, remove it from the legacy list. If this file becomes long, tighten it rather than
letting it drift into a changelog.

At the end of every task, ask: **"Does `AGENTS.md` still describe this repository accurately?"** If
the answer is no, fix it before committing. Stage the updated `AGENTS.md` with the code change. Do
not recreate `PLAN.md` or `PROMPT.md`.

Project status goes in section 13, not in `README.md`. Update it when a stage finishes or an open
item closes, replacing what is out of date rather than appending to it. Date what you verify, and
record what was not verified as plainly as what was.

## 13. Current state and progress

Last updated 2026-11-05.

### Where things stand

- **App:** deployed on Vercel from `main`, served at `https://mempass.vercel.app`.
  `https://members-bay-eight.vercel.app` redirects there. Only the gitignored local `.env.production`
  still names the old host.
- **Database:** Supabase project `potjjlmgnrqxseeendmx`, with migrations through 0016 applied. The
  Supabase GitHub integration applies new migrations when `main` is pushed. 0017 (organizer
  profiles) and 0018 (a placeholder profile for each existing staff account) are in the repo. 0017
  is pushed alone first, and 0018 goes with the app code.
- **Data:** production was reset on 2026-11-04 and has been in use since: staff accounts and a few
  test members exist. Nothing here was read from it after that.
- **Latest stage:** the kiosk reads continuously and can check a member in by name, GDG number, or
  QR code; the event form is cut from 26 fields to 7; and eight bugs from a full UX audit are fixed.
  That is deployed in `7472690`. Since then staff have a profile and a card of their own, tested on
  a local stack. See `docs/test-plan.md`.

### Approved and not built yet

The owner approved these on 2026-11-04, in this order:

1. A single guided card-writing flow, fewer navigation tabs, merged Users and Invitations, simpler
   reward decisions, and plain wording throughout.
2. Permanent delete for superadmins (events and similar records), with the audit log kept.

### Waiting on a person

These are hosted settings that an agent should not change. Check current values rather than assuming
them, and do not record a weak setting here, because this repository is public:

- After each push, confirm its migration is applied to production: 0017 before the app code is
  pushed, then 0018.
- Set the Site URL in Supabase Auth to the production host, as `docs/deployment.md` says. Agents have
  no way to read it from here.
- Confirm `NEXT_PUBLIC_SITE_URL` in Vercel matches the production host before writing physical cards,
  because card URLs are built from it. The origin of a generated invite link shows it.

### Verification record

On a local Supabase stack rebuilt from every migration through 0018, on 2026-11-05:

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass, and `pnpm test` passes 67
  unit tests.
- `pnpm db:verify` passes 83/83.
- The 0018 backfill, run in a rolled-back transaction, passed 8 checks: active staff get one
  placeholder each, revoked staff and members get nothing, and a second run changes nothing.
- `pnpm e2e` passes 53 with 33 skipped: 43/43 on desktop Chromium, and on the mobile project the 10
  public specs pass while the signed-in specs skip by design. The suite covers the always-on kiosk,
  check-in by name and by a typed QR link, the short event form, the bug fixes, a new admin setting
  up a profile, user type changes keeping the profile and card, and organizers being refused points
  and check-in.
- A one-off run on 2026-11-04 with Chromium's simulated camera decoded a member's QR code at the
  kiosk and recorded the check-in as `qr`, with no CSP or permissions-policy violation.

On the physical ESP32 + PN532 with firmware 2.0.2:

- Read-only, with nothing on the reader: the always-on kiosk connected and polled about ten times a
  second for 18 seconds with only `no_card` replies and no errors.
- Earlier the same day, with the old Read button: the app passed invitation, setup, prepare, write,
  read back, activate, the card URL resolving, check-in, check-out, and the points grant. Only
  `navigator.serial` was bridged to COM3, because its picker cannot be automated.

On production, read-only, after `7472690` was pushed on 2026-11-04:

- CI and the Vercel deploy passed, and migrations 0015 and 0016 are applied: the method columns
  exist, `confirm_scan` records the method, and the leaderboard view returns `stars`.
- Public pages load, gated pages redirect to `/login` with the destination, and the leaderboard API
  returns the new fields.

- `anon` can execute no public function, and `authenticated` can execute only the three RLS helpers.
- `/auth/v1/settings` reports `disable_signup: true`.
- Invite links open a Continue page for chat and mail previews without creating a session.

### Not verified yet

- The signed-in parts of the deployed app since `7472690`: the kiosk, the event form, and the fixes
  behind sign-in.
- Organizer profiles on production: migration 0018's placeholder profiles for the real staff
  accounts, the setup step for a new admin, and a card written for an organizer.
- A real card read through the always-on kiosk on the physical reader, and the reader reconnecting
  by itself on a second visit, which needs a real browser's saved port permission.
- A real camera scanning a real phone screen at the kiosk.
- The Chrome or Edge port picker, a hosted `/admin/kiosk` session, and a production card written for
  a live member.
- On real hardware: a locked or too-small card, a card removed mid-write, a purchased card batch, and
  two lanes.

### Known issues and open decisions

- **Decision:** email is public by default and profile pages can be indexed by search engines. The
  email default is deliberate (`PRIVACY.md`). Consider hiding it by default and adding `noindex`.
- **Decision:** the legacy device API is still reachable, though no devices are registered. Consider
  removing it.
- Inviting a staff email as a member is refused, but only after a recovery link was generated, which
  can invalidate that person's outstanding link.
- The public read APIs have no rate limit.
- The database scripts connect without validating the TLS certificate.
- `scripts/admin-enroll-totp.mjs` reads a credentials file that nothing creates anymore.
- Migration 0012 hard-codes a personal email and cannot be edited now that it is applied.
- `pnpm audit` reports one moderate `minimatch` advisory in dev tooling only; `pnpm audit --prod` is
  clean.
