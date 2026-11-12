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

An admin browser drives an ESP32 + PN532 reader over its **USB cable** (Web Serial) or, when no
computer is using the cable, over **Bluetooth** (Web Bluetooth). The cable always wins. The reader
has no WiFi, server client, registration, heartbeat, or writer-job queue, and never reaches the
network by itself; its one secret is its own Bluetooth pairing key. The old WiFi device API is
legacy and must not be revived as part of normal work. See `docs/architecture.md` and
`docs/usb-api.md`.

## 2. Workspace map

| Path                        | Responsibility                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                  | The deployable Next.js app: App Router pages, server actions, route handlers, auth, queries, and UI composition.      |
| `packages/ui`               | Shared Tailwind v4 design tokens, primitives, and branded components. This is the only UI kit.                        |
| `packages/contracts`        | Framework-neutral Zod schemas and shared public types. Validate request/data boundaries here when practical.          |
| `supabase/migrations`       | Schema, RLS, grants, views, storage policy, and transactional domain functions. This is the database source of truth. |
| `scripts`                   | Verification, legacy migration, seed, reset, admin bootstrap, and TOTP enrollment entry points.                       |
| `tests/e2e`                 | Playwright public and authenticated browser tests, including disposable fixtures.                                     |
| `firmware/kiosk-reader`     | PlatformIO ESP32/PN532 firmware for USB and Bluetooth. No network, and no secret compiled in.                         |
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
  -> USB serial, or Bluetooth -> ESP32 + PN532
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
- Card reads are local previews, on either link. They never grant points or complete attendance
  by themselves.
- The reader's cable is trusted because it is physical. Bluetooth is trusted only after the reader
  and the browser have each proved themselves with the reader's pairing key, and every line after
  that is sealed. The browser never holds that key: the server derives it, stores nothing, and
  answers the handshake only for a signed-in organizer.

### Legacy surfaces: do not build on them

Retained for historical records/tests but **not** the current hardware flow:

- `/api/device/v1/*` signed device endpoints
- `/api/admin/kiosk/pending` polling
- writer jobs and card write queues
- `lib/devices/*` signature/auth helpers and the `devices`/`card_write_jobs` tables
- `/admin/usb` and `/admin/devices`

`/admin/usb` and `/admin/devices` redirect to `/admin/cards`; do not add new links to them. Do not
add WiFi, server-stored device secrets, heartbeat, registration, or writer-job behavior to the
current reader flow without an explicit product decision. Bluetooth was such a decision, made on
2026-11-12; what it added is described under Readers in section 6.

## 4. Roles and access control

- **Member** — own profile, card, activity, points, and rewards. Invitation-only; there is no public
  sign-up.
- **Admin** — invitations, revoking member access, cards, events, kiosk, and rewards. Normal admins
  see only the invitations and activity they created (they can still see all members); they do not
  get staff-role management, the manage pages for a member or an organizer, or the full audit log.
- **Superadmin** — inherits admin operations, manages staff roles/invitations, reads the full audit
  log, and owns the manage pages, `/admin/members/[id]` and `/admin/staff/[id]`: type changes,
  status changes, interaction points, attendance corrections, removing an organizer's access, and
  recovery links. Only a superadmin can delete anything for good. A recovery link is a password reset for whoever holds it, so it
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
- Invitation and password reset links are made by hand and are the app's own. There is no SMTP or
  email provider. The admin copies the one-time link; it is a secret. `issueSignInLink` stores only
  the hash of a random token in `sign_in_links`, one link per person, so a new link replaces the
  old one. Pressing Continue redeems it and only then asks Supabase for a session.
- An invitation link works for 72 hours and a password reset link for 48 (`LINK_HOURS`); the
  database refuses more than 72. A member invitation's `expires_at` is its link's. Do not put a
  Supabase token in a link: its lifetime is the hosted OTP window, which cannot exceed 24 hours.
- Staff invitation state is derived from the `admin.invited` audit event plus the **absence** of
  `auth.password_updated`. Do **not** use `last_sign_in_at` or `encrypted_password` for this; they
  are unreliable and previously caused accepted invitations to look pending.
- An invitation whose link has stopped working shows as "Not accepted" on the People page, for a
  member and an organizer alike. New link reopens a member's; inviting an organizer again reopens
  theirs.
- An organizer who has set a password but has no profile yet shows as "Profile not set up" on People
  and their manage page, not as active: the admin area still sends them to `/admin-setup`.

## 5. Route map

| Surface    | Routes                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public     | `/`, `/leaderboard`, `/events`, `/events/[slug]`, `/m/[profileSlug]`, `/c/[cardToken]`, `/card-unavailable`, `/privacy`                                                         |
| Auth       | `/login`, `/forgot-password`, `/account/password`, `/account-suspended`, `/invite/accept`, `/auth/callback`, `/auth/confirm`, `/admin-mfa`, `/admin-setup`                      |
| Member     | `/member`, `/member/activity`, `/member/id`, `/member/profile`, `/member/rewards`                                                                                               |
| Admin      | `/admin`, `/admin/profile`, `/admin/users`, `/admin/cards`, `/admin/kiosk`, `/admin/events`, `/admin/events/new`, `/admin/events/[id]`, `/admin/rewards`, `/admin/rewards/[id]` |
| Superadmin | `/admin/audit`, `/admin/members/[id]`, `/admin/staff/[id]`                                                                                                                      |

Canonical aliases/redirects:

- `/admin/devices` -> `/admin/cards`
- `/admin/usb` -> `/admin/cards`
- `/admin/members` -> `/admin/users`
- `/admin/invitations` -> `/admin/users?invite=1`, which opens the invite forms on the People page
- `/member/privacy` -> `/member/profile#privacy`

The admin area has five tabs: Home, People (`/admin/users`), Cards, Events and Rewards. The member
area has four: Home, Activity, Rewards and Profile. The kiosk opens from Home or an event, the audit
log from Home, and the digital ID from the member Home; each lights the tab that leads to it. A page
with no tab of its own, such as `/admin/profile`, lights none.

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
  read-back before activation. `CardWriter` does all of that from one button, and activates only
  when the link this browser read back is the one it wrote.
- At most one active card per member. The old card keeps working until `activate_card` replaces it,
  so an abandoned write never strands a member. A lost card is revoked explicitly.
- Only the SHA-256 lookup hash and an encrypted token copy are stored. Never persist or log a
  plaintext card token or a full card URL.
- Revocation is explicit and audited. Unknown/revoked/replaced tokens go to the neutral
  `/card-unavailable` page with no member metadata.

### Readers

- One connection per tab, `ReaderManager` (`lib/reader/reader-manager.ts`), shared by Cards and
  the kiosk through `useReader`. Pages send commands with `sendCommand` and never open a port or a
  Bluetooth device themselves.
- The cable always wins, in the firmware and in the browser. A reader on the cable is the link in
  use, and any Bluetooth link is let go, whichever reader it was to. Bluetooth is used with no
  cable, or when the organizer selects Switch to Bluetooth; that choice ends when they switch back,
  the Bluetooth link fails, or the page reloads.
- A switch between links must not show. While one link replaces the other the reader still counts
  as connected, and a command caught in the middle is sent again on the new link.
- A reader is paired by being connected by cable: the browser asks `pairReaderAction` for the key
  and passes it down the cable with `pair.set`. The key is derived from
  `CARD_WRITE_ENCRYPTION_KEY` and the device ID (`lib/reader/keys.ts`); the server stores
  nothing. Raise `READER_KEY_EPOCH` to retire every reader's key, for instance after one is lost.
- The browser never holds a pairing key. `openReaderSessionAction` answers the handshake for a
  signed-in organizer and returns a key for that session only. Do not return, log or audit a
  pairing key or a session key, and do not move the handshake into the browser.
- Over Bluetooth nothing is sent to a reader until it has proved it holds its key, and every line
  after that is sealed (`lib/reader/secure-channel.ts`). The firmware accepts pairing, transport
  and Bluetooth settings from the cable only, and keeps its radio off until it has a key.
- The wire format lives in three places that must agree: the firmware (`ble_link.cpp`,
  `reader_crypto.cpp`), the web (`lib/reader`), and `tools/reader_check.py`. `keys.test.ts` pins
  reference values worked out separately in Python. Change `docs/usb-api.md` with them.
- Firmware 2.0.x is still supported: it speaks protocol 2, and the pages offer it the cable only.

### Permanent delete

- Organizers hide things: an event is cancelled, a reward or a card switched off, a member archived.
  Only a superadmin deletes, and only through `delete_record(kind, id, actor)`, which checks the
  actor, deletes, and writes the `<kind>.deleted` audit entry in one transaction. Do not delete
  rows from TypeScript.
- It covers an event (with its sessions and attendance), a reward (with its handled requests), a
  handled reward request, a card, an attendance record, an invitation (with the unused account made
  for it), and a person's whole account, whose photos the action then removes from storage.
- A delete never takes points or stars back: ledger rows keep their amount and lose only the link.
  A reward with a request still waiting and an attendance that gave points are refused, because the
  correction paths exist for those.
- The entry for a deleted person records their kind and roles, never a name, number or address.
- `is_superadmin()` is an RLS helper tied to the caller's own session and is always false for the
  service role. A function that runs for the server checks `user_roles` directly.

### Audit and rate limits

- Audit rows are append-only and outlive account erasure and every delete. Since 0019 the guard on
  `audit_log` has no exception at all, unlike the ledgers' guard, which an erasure lifts. Nothing
  may update or delete an audit row, and no screen offers to. Never log secrets, card tokens, one-time
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
- `workflows.spec.ts` drives every member and organizer workflow through the real UI with a
  stand-in reader (`tests/e2e/support/fake-reader.ts`) that has a fake Web Serial port and a fake
  Web Bluetooth radio, and does the real handshake and sealing. To run it locally, start the stack with
  `pnpm dlx supabase@2.122.0 start -x realtime,edge-runtime,imgproxy,studio,postgres-meta,logflare,vector,supavisor`,
  export its URL and keys in the shell (process env wins over `.env.local`), then build and serve the
  app on the `E2E_BASE_URL` port. `NEXT_PUBLIC_*` values are inlined at build time, so rebuild
  whenever you switch databases.
- `reader-hardware.spec.ts` runs the real pages against a physical reader and real radio. It is
  skipped unless `READER_PORT` is set, and needs a Bluetooth adapter, a disposable stack and Python
  with pyserial (`READER_PYTHON`). It runs with a window, because Web Bluetooth needs one, and
  answers the chooser over the DevTools protocol; only the serial port picker is stood in for.
  With `READER_CARD=1` and a spare card on the reader it also writes the card over the cable and
  over Bluetooth. The card is left holding a test link, so never use a member's card.
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
python firmware/kiosk-reader/tools/reader_check.py --port COM3 --bluetooth
```

`reader_check.py` checks a plugged-in reader over both links from the outside. It needs
`pip install pyserial bleak cryptography` and a Bluetooth adapter, pairs the reader with a
throwaway key, and leaves it unpaired; the admin pages set it up again the next time it is plugged
in. The firmware build is also part of `pnpm verify`. `docs/hardware-bringup.md` records what has passed
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
- A change that is hard to take back goes through `ConfirmAction`, whose dialog names the person or
  thing it affects. `window.confirm` cannot say that.
- People read the audit log as sentences from `describeAudit` (`lib/audit/describe.ts`). A new
  action code needs a sentence and a topic there, or it shows as a quoted code.
- Use the words the UI already uses: organizer, authenticator app, points history, switch off a
  card, remove access. Not staff, TOTP, ledger or revoke.
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
- A page load must never spend a one-time link. Chat previews and mail scanners fetch a link as soon
  as it is shared, which used to burn invitations within seconds. `/auth/confirm` looks at the link
  to say whether it has expired or been used, and only its button's server action redeems it.
- `/auth/confirm` still accepts the older `token_hash` links so that ones already sent keep working.
  Nothing makes them any more, and none can outlive 2026-11-08; remove the branch after that.
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
- The ESP32 cannot tell a charger from a computer: the board's USB chip is separate from it. "On
  USB" means a computer is talking over the cable, which is why the browser sends `ping` every two
  seconds and `usb.release` when it lets go.
- Opening the serial port resets the board. That also ends any Bluetooth session to that reader and
  clears a `transport.set` override.
- Web Bluetooth's chooser needs a click each time a page is opened: `getDevices()` is behind a flag
  in Chrome, so a reload cannot reconnect by itself. Within one page, a reader chosen earlier can.
- A growing lockout after failed Bluetooth proofs would let anyone nearby silence a reader by
  failing on purpose. The key is too long to guess, so the pause is one second and fixed.
- A Bluetooth peer can say why it is hanging up and hang up in the same instant. `BluetoothLink`
  reads everything it was sent before treating a disconnect as a loss, or the reason is dropped.
- `getByRole('alert')` also matches the route announcer Next.js keeps outside the page. Scope it
  to `main`.
- The audit log is permanent, so a second E2E run finds the first run's entries. Filter by this
  run's actor before counting them.
- `NavTabs` lights the longest matching `href`, so a section's first page (`/admin`, `/member`)
  takes `exact` or it lights up on every page beneath it.
- A form inside a closed `<details>` is still in the page, so a test's `getByText` can match its
  hidden options. Scope the locator to the row or to `main`.
- `db-verify` catches a function that only works with a signed-in session: the first version of
  `delete_record` used `is_superadmin()` and refused every caller.

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

Last updated 2026-11-12.

### Where things stand

- **App:** deployed on Vercel from `main`, served at `https://members.gdgpsu.dev` as seen on
  2026-11-12. `https://mempass.vercel.app` and `https://members-bay-eight.vercel.app` redirect
  there. `README.md`, `docs/deployment.md` and the fallback in `lib/env.ts` still name
  `mempass.vercel.app`; see Known issues.
- **Database:** Supabase project `potjjlmgnrqxseeendmx`, with migrations through 0020 applied. The
  Supabase GitHub integration applies new migrations when `main` is pushed.
- **Data:** production was reset on 2026-11-04 and has been in use since: staff accounts and a few
  test members exist. Nothing here was read from it after that.
- **Latest stage:** the kiosk reads continuously and can check a member in by name, GDG number, or
  QR code; the event form is cut from 26 fields to 7; and eight bugs from a full UX audit are fixed.
  That is deployed in `7472690`. Staff then got a profile and a card of their own, deployed in
  `2df3898` after its schema went ahead in `5cd11ff`. Since then a card is written, checked and
  switched on from one button; the admin area went from eight tabs to five and the member area
  from six to four; invitations moved onto the People page, where each person has one manage page;
  reward requests are decided with buttons; privacy switches save as they are flipped; the activity
  page says why a session gave no points; and the audit log reads as sentences. That part is
  deployed in `214b981`. Last, a superadmin can delete an event, reward, reward request, card,
  attendance record, invitation or account for good, and the audit log can no longer be changed by
  anything. Its schema went ahead in `f187f33` and the app followed in `e18f987`. Since then
  invitation links work for 72 hours and password reset links for 48, an invitation nobody used
  shows as not accepted, and the links are the app's own instead of Supabase tokens. Its schema
  went ahead in `8bd6160` and the app followed in `85f53ef`. An organizer who has only set a
  password shows as "Profile not set up" since `fa2234d`. See `docs/test-plan.md`.
- **Bluetooth:** firmware 2.1.0 and the pages that go with it, deployed in `7655a02`. A reader can
  be used over Bluetooth when no computer is on its cable, the cable always wins, the organizer can
  choose Bluetooth anyway, and the page moves between the two without losing the reader. A reader
  is set up for Bluetooth by being plugged in once. There was no migration. One reader,
  `esp32-a4156cc92df4`, runs 2.1.0 and was left unpaired, so the live pages set it up the next time
  it is plugged in; the other is still on 2.0.2, which the pages keep supporting over the cable.

### Approved and not built yet

Nothing is waiting. The owner confirmed on 2026-11-05 that deleting an event keeps the points and
stars it gave; do not add a way to take them back with the delete. These were left out of permanent
delete on purpose and still need a decision:

- A bonus session that people attended is still only switched off; it goes when its event is deleted.
- An organizer's point award cannot be removed, only outweighed, because the ledgers are append-only.

### Waiting on a person

These are hosted settings that an agent should not change. Check current values rather than assuming
them, and do not record a weak setting here, because this repository is public:

- Set the Site URL in Supabase Auth to the production host, as `docs/deployment.md` says. Agents have
  no way to read it from here.
- Confirm `NEXT_PUBLIC_SITE_URL` in Vercel matches the production host before writing physical cards,
  because card URLs are built from it. The origin of a generated invite link shows it.

### Verification record

On the physical reader `esp32-a4156cc92df4` with firmware 2.1.0 on 2026-11-12
(`docs/hardware-bringup.md` section 9b has the detail):

- `tools/reader_check.py --bluetooth` passed 44 of 44 over the cable and over real radio from this
  computer: pairing by cable only, the handshake both ways, sealed commands, the wrong key, a
  replayed line and an unsealed line each ending the session, a silent caller dropped after 8
  seconds, the cable taking over, the organizer's override, and Bluetooth switched off.
- A command over Bluetooth took about 31 ms. Finding and connecting took 1.7 s.
- `reader-hardware.spec.ts` passed: the real Cards page in Playwright's Chromium, real Web
  Bluetooth, and the real server actions on a local stack. Connected by cable in 1.9 s, set up for
  Bluetooth by itself, connected by Bluetooth in 3.5 s, moved to the cable in 1.9 s when it was
  plugged in, took the organizer's choice of Bluetooth in 5.0 s and gave it back at once, and fell
  back to Bluetooth in 7.5 s, with no error shown. Only the serial port picker was stood in for,
  and "pulling the cable" closed the port while the reader kept its power.
- The NFC module was unplugged for those. With it back and a card on the reader, the same spec
  with `READER_CARD=1` passed too: the one-button writer prepared, wrote, read back and switched
  on a card over the cable in 1.7 s; that card was read over Bluetooth; and a second card was
  written the same way over Bluetooth in 1.7 s, replacing the first. Straight to the reader, a
  card was read, written and read back over Bluetooth. The card was given back the link it came
  with.

On a local Supabase stack on 2026-11-12, for firmware 2.1.0 and Bluetooth, with a stand-in reader:

- `pnpm format:check`, `pnpm lint` and `pnpm typecheck` pass, and `pnpm test` passes 113 unit
  tests. Twenty-two are new: the pairing key and handshake against reference values worked out
  separately in Python, the sealed channel against Node's own AES-GCM including replay and
  tampering, and the link manager against a simulated reader that does the real handshake.
- The firmware builds without warnings in its own sources, at 655 KB of a 1,310 KB slot.
- `pnpm e2e` passes 57 with 39 skipped: 47/47 on desktop Chromium. The new test sets a stand-in
  reader up over its cable, connects by Bluetooth, reads a card with nothing readable on the air,
  moves to the cable when it is plugged in, takes the organizer's choice of Bluetooth and gives it
  back, falls back when the cable is pulled, and refuses a reader holding the wrong key. The
  earlier card and kiosk tests run on the new connection code, and `admin-invitation.spec.ts`
  still uses a protocol 2 reader, which is offered the cable only.
- Playwright's own Chromium, with a window, has Web Bluetooth on this computer and its chooser can
  be answered over the DevTools protocol. `reader-hardware.spec.ts` relies on that.

On the local stack on 2026-11-09, after People and the organizer page learned to say "Profile not set
up": format, lint and typecheck pass, and `pnpm e2e` on desktop Chromium passes 46/46 plus both
invitation specs, which check the label before and after an organizer saves their profile.

On a local Supabase stack with every migration through 0020, on 2026-11-05:

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass, and `pnpm test` passes 91
  unit tests.
- `pnpm db:verify` passes 114/114. Twenty checks cover each kind of delete, what is refused, points
  and stars surviving, the audit entry, and the audit log refusing a delete or an update even during
  an erasure. Eleven cover sign-in links: the two lifetimes, the 72-hour ceiling, single use, a new
  link replacing the old, an expired link, and API roles being unable to read the table.
- The 0018 backfill, run in a rolled-back transaction, passed 8 checks: active staff get one
  placeholder each, revoked staff and members get nothing, and a second run changes nothing.
- `pnpm e2e` passes 56 with 36 skipped: 46/46 on desktop Chromium, and on the mobile project the 10
  public specs pass while the signed-in specs skip by design. The suite covers the always-on kiosk,
  check-in by name and by a typed QR link, the short event form, the bug fixes, a new admin setting
  up a profile, user type changes keeping the profile and card, organizers being refused points
  and check-in, the one-button card writer and its read-back check, the five and four tabs, the
  People and manage pages with their named confirmations, auto-saving privacy, audit sentences,
  and a superadmin deleting an invitation, a reward request, a reward, a card, an event and an
  account through the real pages, with the audit log refusing a delete even from the service key.
  It also covers a link aged past 72 and 48 hours, the page that says so, the People page showing
  "Not accepted" for a member and an organizer, New link reopening an invitation, and a cancelled
  or replaced link no longer working.
- `pnpm db:bootstrap-admin` was run against the local stack and its link opened the Continue page.
- In one of six full runs the legacy device-signature spec got a 500 from the heartbeat route
  ("Body has already been read") on both projects, then passed alone and in the next full run. That
  route is unchanged legacy code.
- A one-off run on 2026-11-04 with Chromium's simulated camera decoded a member's QR code at the
  kiosk and recorded the check-in as `qr`, with no CSP or permissions-policy violation.

On the physical ESP32 + PN532 with firmware 2.0.2:

- Read-only, with nothing on the reader: the always-on kiosk connected and polled about ten times a
  second for 18 seconds with only `no_card` replies and no errors.
- Earlier the same day, with the old Read button: the app passed invitation, setup, prepare, write,
  read back, activate, the card URL resolving, check-in, check-out, and the points grant. Only
  `navigator.serial` was bridged to COM3, because its picker cannot be automated.

On production, read-only, after `7655a02` was pushed on 2026-11-12:

- `7655a02` passed CI and its Vercel deployment is live. The site's `Permissions-Policy` now allows
  Bluetooth and serial to the site itself. Signed out, `/admin/cards` and `/admin/kiosk` redirect to
  `/login` with the destination.
- No reader was connected to production and none was set up for Bluetooth there.

On production, read-only, after `8bd6160` was pushed on 2026-11-05:

- Migration 0020 is applied. `sign_in_links` has RLS on and cannot be read by `anon` or
  `authenticated`, its two functions can be executed by `service_role` only, and a new invitation
  defaults to 72 hours.
- `anon` can still execute no public function.
- `85f53ef` passed CI and its Vercel deployment is live. Signed out, a made-up link redirects to
  `/login?notice=invalid-link`. No real link was made or opened on production.

On production, read-only, after `f187f33` was pushed on 2026-11-05:

- Migration 0019 is applied. `delete_record` can be executed by `service_role` only, and the guard
  on `audit_log` is the one with no exception.
- `anon` can still execute no public function, and `authenticated` only the three RLS helpers.
- `214b981` passed CI and its Vercel deployment is live. Signed out, the old invitation and privacy
  addresses and the new organizer page all redirect to `/login`.
- `e18f987` passed CI and its Vercel deployment is live. No delete was run on production.

On production, read-only, after `2df3898` was pushed on 2026-11-05:

- Migrations 0017 and 0018 are applied. All six active staff accounts have a placeholder organizer
  profile with no photo and only the name shown, and none is on the leaderboard.
- An organizer's public page loads with the Organizer badge and none of a member's numbers.
  `/admin-setup` and `/admin/profile` are deployed and redirect to `/login` when signed out.
- `anon` can still execute no public function, and `authenticated` only the three RLS helpers.

On production, read-only, after `7472690` was pushed on 2026-11-04:

- CI and the Vercel deploy passed, and migrations 0015 and 0016 are applied: the method columns
  exist, `confirm_scan` records the method, and the leaderboard view returns `stars`.
- Public pages load, gated pages redirect to `/login` with the destination, and the leaderboard API
  returns the new fields.

- `anon` can execute no public function, and `authenticated` can execute only the three RLS helpers.
- `/auth/v1/settings` reports `disable_signup: true`.
- Invite links open a Continue page for chat and mail previews without creating a session.

### Not verified yet

- The kiosk over Bluetooth. It reads cards with the same command the Cards page does, which was
  run on the physical reader, but the kiosk page itself was not.
- A reader powered from a charger with no cable to the computer. The run kept it on the laptop's
  cable for power.
- Chrome or Edge themselves with a real reader over Bluetooth, and Chrome on Android. The run used
  Playwright's Chromium.
- The second reader on 2.1.0, and two readers at once.
- Bluetooth on production: a reader set up and used through the live pages while signed in.

- The signed-in parts of the deployed app since `7472690`: the kiosk, the event form, and the fixes
  behind sign-in.
- Organizer profiles on production while signed in: staff editing their placeholder, the setup step
  for a new admin, and a card written for an organizer.
- The new Home, People, manage and audit pages on production while signed in.
- Permanent delete on production. It was never run there, and an agent must not run it there.
- The new links on production: making one, opening it days later, and the Not accepted status.
  Links were aged in the test database, not by waiting.
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
- The site moved to `https://members.gdgpsu.dev`, but `README.md`, `docs/deployment.md` and the
  fallback `SITE_URL` in `lib/env.ts` still name `mempass.vercel.app`, which now only redirects.
  The fallback is used when `NEXT_PUBLIC_SITE_URL` is unset.
- The public read APIs have no rate limit.
- The database scripts connect without validating the TLS certificate.
- `scripts/admin-enroll-totp.mjs` reads a credentials file that nothing creates anymore.
- Migration 0012 hard-codes a personal email and cannot be edited now that it is applied.
- `pnpm audit` reports one moderate `minimatch` advisory in dev tooling only; `pnpm audit --prod` is
  clean.
