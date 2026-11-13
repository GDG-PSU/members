# AGENTS.md

The operating manual for anyone, human or agent, changing this repository. Read
it before you start, and keep it true: a change to architecture, routes,
authentication, the database, commands, tests, deployment or conventions updates
the matching section **in the same change**.

`README.md` is the overview for people. `docs/` is the reference, one subject
per file. Test results live in `docs/test-plan.md`, not here. If this file and
the code disagree, the code and migrations are right: fix this file and say so.
Do not recreate `PLAN.md` or `PROMPT.md`.

## 1. What this is

GDG@PSU's invitation-only member platform: profiles, NFC membership cards, event
attendance, points and stars, rewards, and the organizers' tools.

An organizer's browser drives an ESP32 + PN532 card reader over its **USB
cable** (Web Serial) or, when no computer is using the cable, over **Bluetooth**
(Web Bluetooth). The cable always wins. The reader has no WiFi and never reaches
the network. It holds one key of its own, the site holds the same key, and the
reader obeys nothing else. `docs/usb-api.md` has the protocol.

## 2. Workspace

| Path                    | What it holds                                                                 |
| ----------------------- | ----------------------------------------------------------------------------- |
| `apps/web`              | The one deployable app: Next.js App Router pages, server actions, handlers    |
| `packages/ui`           | Tailwind v4 tokens and components. The only UI kit                            |
| `packages/contracts`    | Zod schemas and types shared across boundaries                                |
| `supabase/migrations`   | Schema, RLS, grants, views, functions. The database's source of truth         |
| `scripts`               | Database checks, reset, seed, first admin                                     |
| `tests/e2e`             | Playwright tests and their stand-in reader                                    |
| `firmware/kiosk-reader` | The reader's firmware (PlatformIO) and its Python tools                       |
| `docs`                  | Architecture, data model, API, reader protocol, operations, deployment, tests |

## 3. Architecture and trust

```text
Browser → Next.js on Vercel → Supabase Auth, Postgres (RLS + SQL functions), Storage
Organizer's browser → USB or Bluetooth → card reader (no network)
```

- The browser holds an HttpOnly session cookie and nothing else. There is no
  browser Supabase client.
- Reads for a signed-in person use the cookie-bound client, so RLS applies.
  `createSupabaseAdmin()` is server-only and comes only after an authorization
  check.
- The publishable key is public, and PostgREST exposes whatever an API role can
  reach in `public`. So `anon` reads published events, `authenticated` also
  reads its own rows and calls three RLS helpers (`is_admin`, `is_superadmin`,
  `current_member_id`), and everything else is `service_role` only.
- Privileged writes happen on the server, through the SQL functions that own
  each transition. Do not reimplement ledger, attendance, card, reward, role or
  reader-key transitions in TypeScript.
- Public data comes from the `public_profiles` and `leaderboard` projections and
  explicit event columns. Never serialize a table row or an Auth user.
- Functions are stateless: rate limits and locks live in Postgres, and there are
  no background jobs.
- A card read is a preview. It never gives points or completes attendance.
- A reader's key is stored sealed in `reader_keys`. The server answers a
  reader's handshake only for a signed-in organizer and returns a key for that
  session alone.

**Retired, do not build on:** `/api/device/v1/*`, `/api/admin/kiosk/pending`,
`lib/devices/*`, the `devices` and `card_write_jobs` tables, and writer jobs.
They belong to a WiFi reader that no longer exists. Adding WiFi, a heartbeat or
device registration back needs a product decision. Two such decisions were made:
Bluetooth (2026-11-12) and server-stored reader keys (2026-11-13).

## 4. Roles and access

- **Member:** their own profile, card, activity, points and rewards.
- **Admin:** invitations, removing a member's access, cards, events, the kiosk,
  rewards, readers. Sees all members, but only the invitations and activity they
  created.
- **Superadmin:** everything an admin can do, plus organizers and their
  invitations, the full audit log, and the manage pages
  (`/admin/members/[id]`, `/admin/staff/[id]`): type and status changes, points,
  attendance corrections, password reset links, and deleting for good. A reset
  link is a password reset for whoever holds it, so it stays superadmin-only.
  The last active superadmin cannot be removed or demoted (a trigger enforces
  it), and nobody can remove their own access.

A user is exactly one of member, admin or superadmin (`set_user_type`).
Organizers also have a row in `members` with `kind = 'organizer'`, because the
profile and the card hang off that table. That row is a profile and a card
holder only: triggers refuse it points, attendance and reward requests, and the
leaderboard leaves it out.

- `viewer.member` is set for members only. `viewer.profile` is anyone's own
  profile; edit it through `requireProfile`.
- A query that means members must filter `kind = 'member'`.
- A new organizer sets up a profile at `/admin-setup` after the authenticator;
  the admin layout sends one without a profile there.
- Promoting a member keeps their profile and card and deletes their points,
  attendance and reward requests. Demoting an organizer turns the profile back
  into a member's if it has a photo; without one the profile is removed and they
  get a setup invitation with `requires_password = false`.
- Removing an organizer's access archives their row, which switches off the
  profile and the card; inviting them again restores it.

Organizer pages and the database's admin policies require **AAL2** (a verified
authenticator code). A page guard is not enough: every action and handler checks
again.

- Pages and actions: `requireMember`, `requireProfile`, `requireAdmin`,
  `requireSuperadmin`. Route handlers: `getApiViewer`, then `isAdmin` or
  `isSuperadmin`.
- Roles live in `user_roles`. Never trust `user_metadata` or anything the client
  sends.
- There is no email provider. Invitation and reset links are the app's own
  (`issueSignInLink`): a random token whose hash is stored in `sign_in_links`,
  one link per person, copied and sent by the organizer. The link is a secret.
- An invitation link works for 72 hours and a reset link for 48 (`LINK_HOURS`);
  the database refuses more than 72. Never put a Supabase token in a link.
- Whether an organizer's invitation is still open is read from the
  `admin.invited` audit entry and the **absence** of `auth.password_updated`.
  Do not use `last_sign_in_at` or `encrypted_password`: they made accepted
  invitations look pending.
- People page statuses: "Not accepted" when the link has lapsed (New link, or
  inviting again, reopens it), and "Profile not set up" for an organizer with a
  password but no profile.

## 5. Routes

| Area       | Routes                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public     | `/`, `/leaderboard`, `/events`, `/events/[slug]`, `/m/[profileSlug]`, `/c/[cardToken]`, `/card-unavailable`, `/privacy`                                                         |
| Auth       | `/login`, `/forgot-password`, `/account/password`, `/account-suspended`, `/invite/accept`, `/auth/callback`, `/auth/confirm`, `/admin-mfa`, `/admin-setup`                      |
| Member     | `/member`, `/member/activity`, `/member/id`, `/member/profile`, `/member/rewards`                                                                                               |
| Admin      | `/admin`, `/admin/profile`, `/admin/users`, `/admin/cards`, `/admin/kiosk`, `/admin/events`, `/admin/events/new`, `/admin/events/[id]`, `/admin/rewards`, `/admin/rewards/[id]` |
| Superadmin | `/admin/audit`, `/admin/members/[id]`, `/admin/staff/[id]`                                                                                                                      |
| Handlers   | `/api/auth/session`, `/api/auth/signout`, `/api/admin/kiosk/confirm`, `/api/profile-photo/[slug]`, `/api/public/events`, `/api/public/events/[slug]`, `/api/public/leaderboard` |

Redirects: `/admin/devices` and `/admin/usb` → `/admin/cards`; `/admin/members`
→ `/admin/users`; `/admin/invitations` → `/admin/users?invite=1`;
`/member/privacy` → `/member/profile#privacy`. Do not link to the old addresses.

The admin area has five tabs (Home, People, Cards, Events, Rewards) and the
member area four (Home, Activity, Rewards, Profile). The kiosk, the audit log
and the digital ID open from a tab's page and light that tab.

`/c/<token>` is a routing identifier that can be switched off. Cards can be
copied, so a tap is never proof of identity.

## 6. Domain invariants

### Identity and privacy

- Membership starts with an invitation and `complete_member_setup`.
- A member's profile needs a face photo, because the kiosk checks the person
  against it; an organizer's is optional. Photos are validated, stripped of
  metadata, cropped and re-encoded on the server (`normalizeProfilePhoto`),
  which reads the format from the file, never the filename.
- Photos are served only through `/api/profile-photo/[slug]`. Never expose a
  storage path.
- Profile fields are hidden in the database projection. Never build a public
  profile by deleting fields from a row.
- Profile links are `https://` only, six at most.
- For 48 hours after `photo_changed_at` the photo is an unverified claim: the
  kiosk asks for a PSU ID and the server refuses a confirmation without
  `identityCheck`.

### Points, stars and rewards

- `point_ledger` and `star_ledger` are append-only; triggers reject `UPDATE` and
  `DELETE`. A balance is a sum; there is no balance column.
- Every grant has a unique `source_key`, so a retry grants nothing twice.
- A correction is a new entry with an actor and a reason. A source key can be
  spent once, so attendance grants use `attendance_grant_key`, which issues a
  new key after a reversal; reusing the old one silently grants nothing.
- Stars are lifetime and cannot be spent. A grant adds equal stars, a spend
  touches none, and a reversal removes them. The leaderboard ranks by stars.
- A reward request is transactional and idempotent. Cancelling or rejecting one
  refunds the points and restocks.
- Amounts are copied onto ledger, attendance and request rows. History does not
  follow later edits.

### Attendance

1. The kiosk identifies a member by a card read, the QR code on their digital
   ID, or an organizer finding them by name or GDG number. Each makes a preview
   that expires.
2. An organizer checks the person and confirms the check-in, and later the
   check-out.
3. Points are given on a confirmed check-out inside the session's times, when
   the session's reward is positive.
4. A second check-in or check-out, a check-out with no check-in, an expired
   preview and a scan outside the session's times fail with stable errors.
5. Corrections go through the audited correction path.

None of the three ways proves who is present, so the photo check, the 48-hour
rule and the confirmation apply to all. `attendance_records` records which was
used (`card`, `qr`, `manual`).

The event form asks for the event's times, its points and two attendance rules;
the four check-in and check-out times are derived in
`lib/events/attendance-rules.ts`. A new event is a draft, its address comes from
its name and never changes, and a published event has ended once its end time
passes. Attendance is unique per member and session, and a bonus session has its
own. Times are stored as `timestamptz` and entered and shown in
`America/New_York`.

### Cards

- `prepare_card` makes a pending card. `CardWriter` writes it, reads it back and
  activates it from one button, and only when the link this browser read back is
  the one it wrote.
- One active card per person. The old card works until `activate_card` replaces
  it, so an abandoned write strands nobody.
- Only the SHA-256 hash and a sealed copy of a card's token are stored. Never
  store or log a card's token or its full link.
- A card that was switched off goes to the neutral `/card-unavailable` page.

### Readers

- A reader holds one random key with a version (`epoch`). The site stores the
  same key in `reader_keys`, sealed with `CARD_WRITE_ENCRYPTION_KEY`
  (`lib/reader/key-store.ts`). Each reader's key is its own.
- The reader obeys only a session opened with its key, **on the cable and over
  Bluetooth alike**, and every line after the handshake is sealed
  (`lib/reader/handshake.ts`, `secure-channel.ts`). Outside a session the cable
  answers `info`, `ping`, `usb.release` and the handshake.
- The browser never holds a key to open a session: `openReaderSessionAction`
  returns the proofs and a key for that session only. Never return, log or audit
  a reader's key or a session key, and do not move the handshake into the
  browser.
- A key reaches a reader three ways. At flashing, from `provision_reader.py`. On
  the cable, for a reader with none (`registerReaderAction`). In an open
  session, for **Rotate key** (`rotateReaderKeyAction`, then
  `confirmReaderKeyAction`). Only the last two pass the key through a browser.
- A key change stores the next version first and retires the old one only after
  the reader has proved it holds the new one. Both work in between, so a change
  that is cut short locks nobody out, and asking again returns the same key.
- One connection per tab, `ReaderManager`, shared by Cards and the kiosk through
  `useReader`. Pages call `sendCommand` and never open a port or a Bluetooth
  device.
- The cable always wins, in the firmware and in the browser. Bluetooth is used
  with no cable, or when the organizer selects Switch to Bluetooth. A switch
  must not show: the reader still counts as connected, and a command caught in
  the middle is sent again.
- The protocol lives in four places that must agree: the firmware
  (`secure_session.cpp`, `reader_crypto.cpp`), the website (`lib/reader`), the
  tools (`tools/reader_link.py`) and the stand-in reader
  (`tests/e2e/support/fake-reader.ts`). `keys.test.ts` pins values made outside
  the app. Change `docs/usb-api.md` with them.
- Firmware older than 2.2.0 has no key. The pages talk to it over the cable in
  the clear and say it should be flashed.

### Deleting for good

- Organizers hide things. Only a superadmin deletes, through
  `delete_record(kind, id, actor)`, which checks the actor, deletes and writes
  the `<kind>.deleted` audit entry in one transaction. Do not delete rows from
  TypeScript.
- It covers an event, a reward, a handled reward request, a card, an attendance
  record, an invitation, and a person's whole account.
- A delete never takes points or stars back. A reward with a request waiting and
  an attendance that gave points are refused; correct those first.
- The entry for a deleted person records their kind and roles, never a name.
- `is_superadmin()` is tied to the caller's session and is always false for the
  service role. A function the server calls checks `user_roles` itself.

### Audit and rate limits

- Nothing can update or delete an audit row, and no screen offers to. Never log
  a secret, a card token, a one-time link, a reader key, or profile content;
  record which fields changed, not their values.
- Rate limits live in Postgres (`withinRateLimit`). Hash client addresses and
  emails into bucket names (`hashForBucket`), and never key a limit on a value
  an unauthenticated caller chooses.

## 7. Commands

Node 20.9 or newer, pnpm 11.5.1, `pnpm install --frozen-lockfile`. CI uses
Node 24.

```bash
pnpm dev                                 # Turborepo → Next 16
PORT=3000 pnpm --filter @gdg/web dev     # when the port must be fixed
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test                                # unit tests
pnpm build
pnpm verify                              # always exits nonzero; see below
```

`pnpm verify` also runs `pnpm audit` and the firmware build, and ends at a
release-coverage gate that is deliberately blocked. Report it as blocked, never
as a pass.

CI (`.github/workflows/ci.yml`) runs format, lint, typecheck, unit tests and the
build. It does not run E2E, `db:verify`, the firmware build or the audit.

### Database

Add schema as a new numbered migration; never edit an applied one, and never
edit a hosted schema by hand. Functions are `SECURITY DEFINER` with
`set search_path = ''`, schema-qualified names and explicit grants. New tables
and functions in `public` start closed to `anon` and `authenticated`.

- `pnpm db:verify`: privilege, invariant and RLS checks against `DATABASE_URL`.
  For a local or staging database only. It can leave temporary rows and refuses
  a hosted host without `DB_VERIFY_ALLOW_HOSTED=yes`. **Never production.**
- `pnpm db:reset`: empties Auth, every `public` table and the photo bucket. A
  dry run without `--confirm <project-ref>`. On production a person runs it,
  never an agent.
- `pnpm db:bootstrap-admin` (`--role`, `--site-url`, `--out`) and
  `pnpm admin:enroll-totp`: operator-only. Never paste what they produce into a
  chat or a log.
- `pnpm db:seed`: local demo data. `pnpm db:migrate`: legacy; do not use it.

### Browser tests

`pnpm e2e` runs Playwright against a server you start yourself. The base URL is
the first of `E2E_BASE_URL`, `NEXT_PUBLIC_SITE_URL`, `http://localhost:3100`.

- Signed-in specs need a disposable Supabase stack and
  `CARD_WRITE_ENCRYPTION_KEY`. They create and remove their own accounts. They
  skip a hosted `*.supabase.co` project unless `E2E_ALLOW_HOSTED_SUPABASE=yes`,
  which is never set for production.
- Local stack:
  `pnpm dlx supabase@2.122.0 start -x realtime,edge-runtime,imgproxy,studio,postgres-meta,logflare,vector,supavisor`,
  export its URL and keys in the shell (the shell wins over `.env.local`), then
  build and serve the app on the `E2E_BASE_URL` port. `NEXT_PUBLIC_*` values are
  inlined at build time, so rebuild when you switch databases.
- `workflows.spec.ts` drives every workflow through the real pages with the
  stand-in reader, which has a fake cable and a fake radio and does the real
  handshake and sealing.
- `reader-hardware.spec.ts` runs the real pages against a physical reader and
  real radio. It is skipped without `READER_PORT`, needs a window, a Bluetooth
  adapter and Python with pyserial (`READER_PYTHON`), and a reader already given
  its key for the test stack by `provision_reader.py`. Clear the key afterwards
  with `--clear`. With `READER_CARD=1` it also writes the card on the reader,
  so never use a member's card.
- One spec, one project:
  `pnpm e2e tests/e2e/admin-invitation.spec.ts --project=desktop-chromium`.

### Firmware

```bash
pio run -d firmware/kiosk-reader
pio run -d firmware/kiosk-reader --target upload --upload-port COM3
python firmware/kiosk-reader/tools/provision_reader.py --port COM3   # give it its key
python firmware/kiosk-reader/tools/reader_check.py --port COM3 --bluetooth
pio run -d firmware/kiosk-reader --target erase --upload-port COM3   # a key nobody knows
```

The tools need `pip install pyserial bleak cryptography`. `provision_reader.py`
reads the site from the environment or the root `.env.local` and writes nothing
to a hosted project without `--confirm <project-ref>`. `reader_check.py` needs a
reader with no key and leaves it with none. Bump `GDG_FIRMWARE_VERSION` in
`platformio.ini` with every firmware change. Claim only the hardware results
`docs/test-plan.md` lists.

## 8. Conventions

- Strict TypeScript: no `any`, no non-null assertion to hide real doubt. `@/`
  inside `apps/web`. `import 'server-only'` on modules that touch secrets.
- Validate outside input with Zod at the boundary. Return messages people can
  read; log details without secrets.
- Route handlers use `jsonOk`, `jsonError`, `handleApiError` and a request ID,
  and never cache a private response. A handler that reads or sets the session
  calls `isSameOriginRequest`; server actions get that check from Next.
- A server action re-checks authorization, validates, calls the domain function,
  writes the audit entry and revalidates. An exported action is a public
  endpoint: give it the role of the page that uses it, and delete it when
  nothing does.
- A `useActionState` form people type into takes
  `onReset={keepValuesOnError(state)}`, and its action returns `{ error }`
  rather than redirecting, so nothing typed is lost.
- A change that is hard to take back asks first, in a dialog that names what it
  affects (`ConfirmAction`, or `ConfirmDialog`). Never `window.confirm`.
- A new audit action needs a sentence and a topic in `lib/audit/describe.ts`.
- Use the words the pages use: organizer, authenticator app, points history,
  switch off a card, remove access. Not staff, TOTP, ledger or revoke.
- Sign out with `signOut({ scope: 'local' })`. A sign-in continues only to a
  path `safeReturnPath` accepts.
- Use the date helpers; never hand-roll a timezone conversion.
- Render with `@gdg/ui` and its tokens. No second design system, no hard-coded
  brand colors, and keep light and dark working.
- Comments explain a reason or an invariant, never restate the code.
- Run Prettier on the TypeScript, JSON and Markdown you touch. SQL and firmware
  have their own conventions; do not reformat them.

## 9. Git

**Work on `main`.** No branch and no pull request unless asked. **Commit and
push only when asked.** Never force-push or amend a pushed commit without
permission.

1. Look at `git status --short` and the diff. Stage only what belongs to the
   task.
2. Never commit `.env*` (except the template), `.local/`, `.next/`,
   `node_modules/`, test reports, logs or build output. `next dev` rewrites
   `apps/web/next-env.d.ts`; restore it before staging.
3. Imperative subjects. Say why in the body when it is not obvious.
4. The repository is public. Keep the details of an unfixed vulnerability, and
   any weak hosted setting, out of commits and docs.

**No AI attribution.** No "Generated with" line, no `Co-Authored-By` trailer for
an agent or a tool, no agent name, no `--author`. Commits come from the
configured identity.

Try `git commit` as configured. If it hangs at signing, or fails only because
the signing agent or passphrase is unavailable, cancel and retry the same commit
with `--no-gpg-sign`. Do not change `commit.gpgsign`.

The app and the migrations deploy from the same push at different speeds. When
the old app cannot run on the new schema, or the new app on the old, push the
schema first, confirm it applied, then push the rest.

## 10. Gotchas

**Environment**

- Quote shell paths that contain route-group parentheses.
- Next reads `apps/web/.env.local`; the scripts and tools read the root
  `.env.local`. **In this checkout the root one points at production**, so point
  anything that writes elsewhere with `DATABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_URL`.
- `NEXT_PUBLIC_SITE_URL` must be the origin in use: one-time links and card
  links are built on it.
- Hosted Auth settings are not in `supabase/config.toml`, which configures the
  local stack only. `docs/deployment.md` lists what production needs.

**Supabase and SQL**

- `revoke ... from public` removes nothing from `anon` or `authenticated`: their
  grants are direct. Check with `has_function_privilege` or `pnpm db:verify`.
- `.maybeSingle()` returns `null` and an error when several rows match. Add
  `.limit(1)` when a filter can match more than one.
- `raise exception` rolls back the function's earlier statements, so setting a
  status and then raising records nothing.
- RLS hides a suspended member's profile from themselves, so viewer queries must
  not inner-join `member_profiles` to `members`.
- The card route's nested embed
  (`members!inner(... member_profiles!inner(...))`) is deliberate: there is no
  foreign key from `card_credentials` to `member_profiles`.
- Locally, `[auth.email] enable_signup = false` switches the email provider off
  and breaks sign-in. Sign-up is closed at `[auth]` instead.
- A local Docker volume can sit at an older migration and fail `db:verify`
  falsely. Run `pnpm dlx supabase@2.122.0 migration up --local` first.

**Sessions and links**

- The proxy must cover every route that renders the root layout. A Server
  Component cannot write cookies, so a token refreshed elsewhere is lost and the
  replayed refresh token ends the session. A proxy redirect must copy the
  refreshed cookies.
- A password change ends the person's other sessions.
- A page load must never spend a one-time link: chat previews and mail scanners
  open links at once. `/auth/confirm` only looks; its button redeems.
- `mfa.enroll` without `issuer` names the authenticator entry after the hosted
  Site URL, so the app passes the `SITE_URL` hostname.

**Next.js and UI**

- `apps/web/tsconfig.json` includes `.next/dev/types`. After removing a route, a
  stale folder fails `typecheck` and a local build; regenerate or clear it.
- `Permissions-Policy` is fixed when a document loads and survives client-side
  navigation, so the camera, serial and Bluetooth are allowed site-wide.
- `flex-1` on a fixed-height control in a column flex container replaces its
  height.
- `NavTabs` lights the longest matching `href`, so a section's first page takes
  `exact`.

**Readers**

- The ESP32 cannot tell a charger from a computer. "On USB" means a computer
  spoke over the cable in the last 6 seconds, which is why the browser pings
  every 2 seconds and sends `usb.release` when it lets go.
- Opening the serial port restarts the board, which ends every session and a
  `transport.set` override.
- A reader with no key takes one from the first page it is plugged into. Never
  plug one into a site running older pages or another database: it would hold a
  key the real site does not, and need erasing.
- A browser tab connected to a reader holds its COM port (Brave too), so a flash
  or a tool gets "Access is denied" until the tab lets go.
- The device ID is the chip's address printed low byte first: its **first** four
  characters differ between readers, and its last are the manufacturer's. The
  Bluetooth name uses the first four.
- Web Bluetooth's chooser needs a click on every page load.
- The pause after a failed Bluetooth proof is one second and fixed. A growing
  one would let anyone nearby silence a reader by failing on purpose.
- A Bluetooth peer can say why it is hanging up and hang up at once.
  `BluetoothLink` reads everything it was sent before it treats a disconnect as
  a loss.
- Sealing is asynchronous, so both links queue what they send and what they
  receive. Lines must be sealed and opened in order.
- The kiosk reads all the time. A card counts as "on the reader" until a read
  says `no_card`, so it is never read twice.

**Tests**

- `getByRole('alert')` also matches Next's route announcer. Scope it to `main`.
- The audit log is permanent, so a second run finds the first run's entries.
  Filter by this run's actor before counting.
- A form inside a closed `<details>` is still in the page; scope locators.
- A message that also appears in the reader's log matches twice. Match the whole
  sentence.
- The stand-in reader keeps a card "on the reader" until the test lifts it.

## 11. Before you finish

- [ ] The change does what was asked and nothing else.
- [ ] The smallest relevant checks ran, and their real results are reported.
- [ ] New logic, authorization or a critical flow has a focused test. No test
      was skipped or weakened to pass.
- [ ] No secret, one-time link, card token, reader key or private data is in the
      code, the logs or the diff.
- [ ] This file and the affected docs are true again. A new failure mode has a
      gotcha; a removed surface is gone from the lists.
- [ ] Section 12 is current, and new test results are in `docs/test-plan.md`.
- [ ] `git status` shows only what you meant to change.

Keep this file short. Replace what is out of date rather than adding to it, and
put history in the commit log.

## 12. Current state

Last updated 2026-11-13.

- **App:** on Vercel from `main`, at `https://members.gdgpsu.dev`. The two
  Vercel addresses redirect there.
- **Database:** Supabase project `potjjlmgnrqxseeendmx`. Migrations through 0020
  are applied; the GitHub integration applies new ones on a push to `main`.
- **Not deployed yet:** stored reader keys, the locked cable, Rotate key and the
  manual writer: migration 0021, the app, and firmware 2.2.0. Both readers
  (`esp32-a4156cc92df4` and `esp32-3c1c6cc92df4`) run 2.2.0 and hold no key.
  After the deploy, give each its key with
  `provision_reader.py --confirm potjjlmgnrqxseeendmx`. Until then they must not
  be plugged into the live site, which would give them a key the new version
  cannot use.

### Waiting on a person

Hosted settings an agent should not change. Check them rather than assuming, and
record no weak setting here.

- The Site URL in Supabase Auth must be the production host.
- `NEXT_PUBLIC_SITE_URL` in Vercel must be the production host before cards are
  written.

### Decided, do not reopen

- Deleting an event keeps the points and stars it gave (2026-11-05).

### Open

- Email is public by default, and profile pages can be indexed. Consider hiding
  email by default and adding `noindex`.
- The retired device API is still deployed. Consider removing it.
- A bonus session that people attended can only be switched off, and a points
  award can only be outweighed, never removed.
- The public read APIs have no rate limit.
- The database scripts connect without validating the TLS certificate.
- `scripts/admin-enroll-totp.mjs` reads a credentials file nothing creates.
- The `token_hash` branch in `/auth/confirm` is dead: no such link can still
  work. Remove it.
- Migration 0012 hard-codes a personal email and cannot be edited.
- `pnpm audit` reports one moderate `minimatch` advisory in dev tooling;
  `pnpm audit --prod` is clean.
