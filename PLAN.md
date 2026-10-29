# GDG@PSU Member Points & NFC System — Implementation Plan

> **Purpose:** This is the product, architecture, security, implementation, and acceptance specification for a coding agent building the production-minded first version of the GDG@PSU member portal and NFC attendance system.
>
> **Execution rule:** Implement this plan, do not merely summarize it. If a decision is already made here, do not ask the user to make it again. Use safe local mocks and documented placeholders for work that can be completed without production credentials. Stop and ask the user when a real external dependency, credential, physical-hardware fact, policy decision, or irreversible production action is genuinely required. Never claim a test passed unless it was actually run and passed.

## 1. Product vision

Build a polished, responsive, low-clutter web experience and hardware-backed workflow for GDG@PSU members to:

- receive an invitation after membership is confirmed;
- accept the invitation, set a password through Supabase Auth, upload a photo, and provide their display name;
- receive a permanent, opaque profile URL;
- optionally receive a physical NFC card whose static NDEF payload contains only a revocable URL;
- view points, lifetime stars, completed event attendance, rewards, and their profile;
- decide which profile fields and activity metrics are public;
- show a digital ID QR when a physical card is unavailable;
- earn points through staff-validated event check-in/check-out and approved in-event activities;
- redeem points for rewards without losing lifetime stars.

Admins manage invitations, members, roles, profiles, NFC cards and event cards, events and bonus sessions, attendance validation, point awards/redemptions, devices, audit history, and admin-issued password recovery links.

The product should feel like a carefully designed digital membership card and event companion—not a large text-heavy management system. The primary surfaces should be visual, scannable, and easy to use on a phone in a noisy event environment.

## 2. Decisions fixed by this plan

These decisions resolve ambiguity in the initial brief and should be followed unless a genuine blocker requires the agent to ask the user.

### 2.1 URLs and NFC revocation

Use the following public origin, configured by `NEXT_PUBLIC_SITE_URL` and defaulted to `https://member.gdgpsu.dev` in production documentation:

- `/` — public GDG@PSU member hub with leaderboard, current/upcoming public events, and a concise explanation of the system.
- `/m/<public_profile_id>` — stable member profile URL, created **only after the member accepts the invitation and completes required setup**. There are no usernames in v1. The ID is a randomly generated opaque URL-safe identifier; it is not an internal database ID and is not an authentication credential.
- `/c/<card_token>` — a revocable card URL written to the NFC member card as one HTTPS NDEF URI. When active, the server redirects to the member's stable `/m/<public_profile_id>` URL. If the card is lost, replaced, or revoked, this URL stops redirecting. Never use an arbitrary user-supplied redirect destination.
- `/e/<public_event_id>` — stable public event information URL, usable on optional event-information NFC cards. This is public information only, not an attendance credential.

**Do not write `/m/...` directly to a member's physical card.** The earlier requirement that a lost card's static URL can be discontinued is best satisfied by putting the revocable `/c/...` link on the tag and redirecting to the independent permanent `/m/...` profile. A public profile permalink continues to work after a card is replaced.

The tag contains no name, email, internal member ID, points, stars, event history, auth token, password, or device secret. A `/c/` token is a public locator that can be read and copied; it is **not** a secure credential. It must never authenticate a member, authorize a point award, or permit access to a member account.

### 2.2 Privacy defaults

A newly activated member profile defaults to public for profile-presentation fields and public activity metrics, as requested. Members can turn off the whole public profile or toggle supported fields individually. QR codes and card tokens are never rendered on a public profile. The email field is also member-controlled and defaults to public to match the product brief; the activation screen must clearly call out that choice and link directly to privacy settings before the member completes setup. Members can make email private at any time, and whole-profile privacy overrides every field.

Internal database IDs, Supabase Auth IDs, raw card tokens, device secrets, invite tokens, and audit metadata are never public. A visible member code may be a separate random display identifier and can have its own visibility toggle; it must not be the database key. Email visibility must be enforced server-side on every profile projection and cache/image/leaderboard path, not only hidden in the UI.

A member who chooses a fully private profile still must supply a display name and photo during activation. Those details remain available only to authorized admins/kiosk operators for identity confirmation. `/m/...` then shows a neutral private-profile state with no member details. Card URLs continue to respect the profile's privacy setting.

### 2.3 Points, stars, and attendance

- **Points balance** is spendable: positive award entries increase it; redemption entries decrease it; refunds restore it.
- **Stars** are lifetime earned credit and are never spent. Each positive point award also grants the same number of stars. Point redemptions and redemption refunds have `stars_delta = 0`.
- Treat point and star changes as an immutable ledger with auditable, transaction-safe balance updates. Never merely overwrite a balance without a ledger entry.
- Regular events and optional bonus sessions are first-class event/session records. A bonus study session can be configured separately from the main event and awards points only for its own valid attendance.
- Event attendance requires staff-confirmed check-in and staff-confirmed check-out. No check-out means **no automatic point award** and does not count as completed attendance. Members with a dispute are directed to `gdg@psu.edu`; any staff correction must be explicit, authorized, reasoned, and audited.
- A valid check-in/out pair may count as completed attendance even when the duration is too short for points. The minimum-duration rule governs points, not the truth of the attendance record. This should be stated in member-facing event rules.
- A scan by itself never awards points. Every attendance transition and activity award is authorized by an authenticated admin/operator in the kiosk UI.

### 2.4 Authentication and account support

Use Supabase Auth for all passwords, password hashing, session issuance, invitation verification, and password changes. Never create a password column or handle password hashes in application tables.

There is no open self-registration. Only an authorized admin can invite a member. The first invitation can use Supabase's invite email flow; the member follows the email link, establishes a session, sets a password, supplies a name and photo, agrees to the club's stated data visibility behavior, and completes activation. Only then is the public profile ID minted and the stable profile URL created.

There is no public self-service “forgot password” flow in v1. Members contact `gdg@psu.edu` from their registered email. An admin can generate/send a short-lived Supabase recovery link from the admin portal. Authenticated members may change their password after reauthentication.

### 2.5 Hardware trust model

The two ESP32 + PN532 lanes communicate only with the central HTTPS API. ESP32 firmware never connects to Supabase or the database directly.

Each registered device has a unique allowlisted device ID and a unique per-device secret used to sign requests. The ID is not itself a secret. Secrets are not committed to Git and are not shared between lanes. The server can revoke or rotate one device without re-provisioning the other. Every scan is a pending observation; a staff member verifies the member's photo and confirms the intended action in the admin kiosk before attendance or points change.

Because static NFC data is copyable, the system **does not claim cloning prevention**. The security boundary is staff validation, a revocable public card locator, rate-limited and authenticated device endpoints, audit history, and no privilege attached to possession of a card URL.

### 2.6 Design system

Use **Material 3 Expressive** as the sole visual and interaction design source of truth. Implement it as a web-first token and component system with accessible low-level primitives; do not mix in a second design language. Required design tokens include semantic light/dark color roles, typography, shape, elevation, spacing, focus, and motion. Use expressive hierarchy and shapes sparingly but intentionally. Prioritize content density, legibility, responsive behavior, and fast task completion over decoration.

Use a custom shared component library in `packages/ui` (or equivalent root workspace package) to keep the design consistent. Low-level accessibility primitives may support the implementation, but their default styles must not replace the Material 3 Expressive design system.

## 3. Scope

### 3.1 V1 deliverables

1. Public home and points/stars leaderboards filtered by each member's visibility settings.
2. Public member profiles with per-field visibility and privacy-safe profile rendering.
3. Member authentication, first-run activation, profile editor, digital ID, points/stars, event history, and reward redemption.
4. Admin authentication and role-gated dashboard.
5. Member invitation lifecycle, member management, profile moderation, admin-issued password recovery links, and membership status controls.
6. Event/session management, check-in/check-out rules, attendance queue and operator confirmation, manual activity awards, and audit trail.
7. Points ledger, lifetime stars accounting, reward catalog, redemptions, refunds, and balance reconciliation.
8. NFC card issuance/replacement/revocation and read/write workflows through the registered ESP32 + PN532 devices.
9. Optional event-information NFC tags using `/e/...` URLs.
10. Device registration/configuration status, health/heartbeat, key rotation/revocation, and lane labels.
11. Supabase migrations, RLS policies, pgTAP database tests, API/unit/integration tests, browser E2E tests, firmware tests where supported, CI, documentation, and a complete Git repo.
12. A fake/local development mode and seed data that permit meaningful testing without production secrets or physical hardware.

### 3.2 Non-goals for v1

- No card-based login, NFC-based passwordless authentication, or attendance without human validation.
- No automated payments, payment provider integration, or membership-fee collection. Admins manually confirm that the fee has been paid before sending an invite.
- No public email directory.
- No public display of QR codes, card-token values, or internal IDs.
- No dependence on a particular commercial mail provider beyond a clearly documented production SMTP/custom-email configuration.
- No assumption that Penn State's network policy permits ESP32 devices on eduroam. Firmware should support the required secure network configuration, but a real-campus connection must be validated by the user/PSU IT.
- No claim that hardware-attached tests passed when the agent cannot access the physical readers/cards or campus network.

## 4. Recommended monorepo architecture

Prefer a **single Next.js web application plus firmware and shared packages**, keeping the deployable web app simple while still maintaining a real monorepo.

Suggested layout (adapt only when the existing repository makes a different arrangement clearly better):

```text
.
├── app/                         # Next.js App Router: pages, layouts, route handlers
├── components/                  # App-specific components
├── packages/
│   ├── ui/                      # Material 3 Expressive tokens and shared components
│   ├── domain/                  # Shared domain types, schemas, pure business rules
│   └── config/                  # Shared lint/format/TypeScript config if needed
├── firmware/
│   └── esp32-kiosk/
│       ├── platformio.ini
│       ├── src/
│       ├── include/
│       ├── test/
│       └── README.md
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   ├── seed.sql
│   └── tests/
├── e2e/                         # Playwright end-to-end tests
├── scripts/                     # Bootstrap, audit, fixtures, verification helpers
├── docs/                        # Architecture, operations, runbooks, hardware setup
├── .github/workflows/           # CI checks
├── .env.example
├── .gitignore
├── .editorconfig
├── PLAN.md
├── PROMPT.md
├── README.md
├── package.json
├── pnpm-lock.yaml
└── pnpm-workspace.yaml
```

If there is a strong compatibility reason to place the Next.js application under `apps/web`, that is acceptable; document the decision and configure Vercel's root/build settings accordingly. Do not create extra deployable apps or services without a specific need.

### 4.1 Web stack

- Next.js App Router, React, TypeScript strict mode.
- pnpm workspaces; Turborepo is acceptable if it materially improves task orchestration, but do not add it merely for fashion.
- Supabase Auth, Postgres, Storage; use `@supabase/ssr` for cookie-aware server rendering and the supported Supabase JS client.
- Vercel hosting for the web app; no secrets in client bundles.
- Zod (or equivalent strongly typed schema validator) for all environment variables, incoming API requests, and important form input.
- Vitest for pure/unit tests, Playwright for browser E2E, and pgTAP/`supabase test db` for RLS and database invariants.
- An accessible low-level component primitive library may be used where useful, but wrap and style it through the Material 3 Expressive shared design system.
- Use the latest mutually compatible **stable** versions available at implementation time, not canary/beta releases. Pin the package manager and dependency lockfile. Record the chosen versions in `README.md` or `docs/architecture.md`.

### 4.2 Firmware stack

Use PlatformIO with the ESP32 Arduino framework (or a documented equally mature ESP-IDF solution if the actual hardware/library combination justifies it). The Adafruit PN532 library is a reasonable starting point because it supports PN532 over I2C and SPI; keep PN532 operations behind a small adapter so the rest of the firmware can be unit tested. Use TLS certificate verification and HMAC-SHA-256 request signing.

Pin firmware dependency versions. Do not disable TLS certificate checking to make campus Wi-Fi/API calls succeed. Hardware pin assignments, PN532 interface mode, board model, and the actual NFC tag model must be configurable and documented. Avoid assuming a PN532 clone's switch/jumper layout without a real board model.

### 4.3 Deployment topology

- One Vercel web project serves public pages, member portal, admin portal, kiosk UI, and API route handlers.
- Supabase provides Auth, Postgres, Storage, database functions, and optionally private realtime/polling primitives as needed.
- The two ESP32s call versioned server endpoints over HTTPS; they never hold Supabase API credentials and never access tables directly.
- Vercel environment variables supply server-only Supabase credentials and application URL.
- The local development environment uses the Supabase CLI/local stack when Docker is available, plus seeded test accounts and hardware/device mocks.

## 5. User roles and main journeys

### 5.1 Roles

- **Visitor:** can see public events, public profile fields, and leaderboards where each member has opted to publish the corresponding metric.
- **Member:** can sign in, see and change their own allowed profile fields/settings, view their ledger/history, see their active digital ID, request rewards, and change their password while authenticated.
- **Admin:** can manage members, invites, events, attendance validation, cards, devices, point awards, rewards, redemptions, and support recovery links.
- **Kiosk operator:** an admin-authorized staff role for a scoped event/lane interface. It may be the same underlying role as admin for v1, but the model must allow later least-privilege separation. Never let an unauthenticated public browser operate the kiosk.

Every server mutation checks the caller's authorization at the server/database boundary. Hiding an admin button or route in the UI is not authorization.

### 5.2 Member invitation and activation

1. Admin records the verified paid member's email and sends an invitation from the admin portal.
2. Store a pending invitation row and status/timestamps. The Supabase invite email contains a secure one-time link, not a permanent profile URL or a card URL.
3. The member opens the link, completes Supabase's invite/verification flow, sets a password, and establishes a server-managed session.
4. Activation collects a display name and photo, shows the default visibility behavior clearly, and allows the member to change visibility before completing setup.
5. In a transaction/idempotent activation workflow, create the profile ID and public member code, mark the invitation/member active, and create the profile route identity. Do not create a profile permalink or card token earlier.
6. The member lands on their dashboard. They can view the permanent profile URL and edit settings. No physical card is assumed to exist yet.
7. Admin can later initiate card issuance. Once the card is physically written and verified, send the configured “card ready” notification using the configured mail delivery path. If production email is not configured, show an honest actionable status instead of pretending an email was delivered.

Supabase Auth Admin API operations (for example inviting users or generating recovery links) must happen only in a trusted server environment with a server-only secret key. Do not use an admin key from browser code.

### 5.3 Profile and privacy settings

The member page should include a visually prominent name/photo, points balance, lifetime stars, member-since date, public link/share affordance where appropriate, events attended, activity highlights, and external links. The dashboard should make current points, stars, next event, and redemption options obvious without requiring dense reading.

Use an explicit `profile_is_public` control and per-field settings for photo, display name, email, about text, links, member-since, member code, points, stars, and event history. These profile fields default public, except QR/card-token data and non-profile account/security metadata, which are never public. Clearly disclose the public-by-default email choice during first-run activation. An overall private profile must override individual public-field settings. Verify the privacy rules on the server for every public profile, leaderboard, event list, image endpoint, and API response.

Photos must be validated, size-limited, and stored in a private Supabase Storage bucket. Serve public avatar requests through a server endpoint that checks the current privacy flags before returning the image; avoid leaving public bucket URLs or indefinitely cached signed URLs behind when a member switches their profile private. Strip EXIF metadata by re-encoding images; only permit supported image formats and set a conservative upload limit (for example 5 MB).

### 5.4 Kiosk attendance flow

1. An admin configures the active event/session and which lane devices are available.
2. The PN532 reads one NDEF URI and the ESP32 sends the card locator to the server with its signed device request.
3. The server validates the device identity, request signature, timestamp, nonce/idempotency ID, input size, and token format. It records a pending scan; it changes no attendance or points.
4. The authenticated kiosk UI surfaces the pending scan with timestamp, lane, member name/photo, current attendance status, and the available next action. If no active member/card is found, show a generic invalid/inactive-card state without disclosing other member data.
5. A staff operator compares the displayed photo with the person and explicitly confirms Check in, Check out, or Dismiss. For a valid member scan, the server rechecks permissions, card/member status, event/session state, duplicate scans, and attendance state inside the transaction.
6. A member can only have one open attendance interval for an event/session. Duplicate scan submissions and retries must not duplicate attendance or point entries.
7. Check-out calculates elapsed time using server timestamps, not an ESP32-supplied clock. The server applies the configured attendance rules. If the check-out is too early, attendance is recorded but points are not awarded. If there is no check-out, award no points. A completed eligible attendance creates the configured points and equal stars atomically.
8. The scan is marked handled and the audit trail records who confirmed/dismissed it, the event/session, lane/device, and result. Avoid storing more device/network metadata than needed.

Pending scan events need a short TTL; stale scans must not be confirmable against the wrong event. A deliberate refresh/rescan should be required. Admins must be able to dismiss duplicate/invalid scans and see reader/network health.

### 5.5 Activity and bonus awards

Admins can configure an event-specific list of named activities (e.g. challenge completed, workshop contribution, small win) with point values and optional limits. Staff selects a member through a validated card scan or member search, selects the activity, reviews the award, and confirms. Every award produces a ledger entry and an audit event. Add server-side caps and duplicate rules where configured; never trust point amounts sent by the browser.

A bonus session such as an after-event study session is a separate session with its own check-in/out and duration/points settings. Attendance at the main event must not silently grant bonus-session points.

### 5.6 Reward redemption

Members browse active rewards and submit a redemption request. The server atomically checks available balance and prevents overspending. Use explicit request states such as `requested`, `approved`, `fulfilled`, `rejected`, and `cancelled`; document exactly when the points are reserved/deducted. Recommended rule: reserve/deduct at approval, fulfill from the reserved amount, and create a compensating points-ledger entry if an approved redemption is cancelled/rejected before fulfillment. No operation deletes a ledger entry. Every transition is idempotent and audited.

Admins can configure reward name, image, description, point cost, availability/inventory, active state, and fulfillment notes. Show stars as lifetime achievements only; never imply stars are spendable.

### 5.7 Card issuance, replacement, and revocation

1. Admin selects an active member and requests card issuance.
2. Server generates a cryptographically random card locator/token, binds it to that member in the database, and creates a one-time, short-lived write job for the chosen registered lane. Do not encode a database ID or the member's information.
3. The operator presents a compatible blank NFC tag. The ESP32 writes one HTTPS NDEF URI (`/c/<card_token>`), reads it back, parses it, and reports a result. The web UI confirms success only after the server receives the verified result; otherwise it shows a clear failed/retry state.
4. Once written and read-back-verified, the admin confirms the card is issued. The system records issuance time, issuing admin, device/lane, and status. Then send the card-ready email if production email is configured.
5. On loss or replacement, revoke the old token immediately and issue a new token. `/c/<old>` must stop redirecting. The member's `/m/<public_profile_id>` URL remains unchanged.
6. The authenticated “Show ID” action generates a QR for the member's current active card locator. If no active physical card exists, the app clearly explains that a digital ID has not yet been provisioned. A replacement can have a new virtual credential QR before the new physical tag is handed over; the old tag's token remains revoked.

The NFC URI itself must never authorize point awards or login. If an attacker clones a tag, the kiosk still requires an authenticated staff confirmation and a human/photo check. The UI and runbook must state this plainly.

### 5.8 Event-info and activity cards

Event-info NFC cards, when used, encode only `https://member.gdgpsu.dev/e/<public_event_id>` and open public event information. They are not attendance credentials. If a user actually intends event tags to have a different job, ask before building a less secure or semantically different mechanism. For v1, member-point activity awards are administered in the authenticated kiosk rather than being granted by simply reading a static activity tag.

### 5.9 Password support

- First-run password setup follows the invitation flow.
- Authenticated password change requires the supported Supabase flow and reauthentication where appropriate.
- A member who forgot their password contacts `gdg@psu.edu` from the registered email address.
- Admin verifies the request and uses a server-side Supabase recovery-link generation flow. The link is single-use/short-lived as supported by configured Supabase Auth settings, is sent through the configured email channel, and must never be written to application logs or audit metadata in raw form.
- Admin portal displays an honest result: generated, queued/sent by provider, or failed. If there is no working mail provider, show a safe one-time link handling workflow and require an explicit admin action; do not silently claim “email sent.”

## 6. Route and page map

Use a coherent, mobile-first navigation. Route names can be adjusted if documented, but preserve these capabilities.

### Public

- `/` — compact home, public leaderboard tabs (Points / Stars / Active members), upcoming public events, a few visual metrics, clear member/admin sign-in actions.
- `/m/[publicId]` — privacy-aware member profile.
- `/c/[cardToken]` — active card URL redirect; revoked/unknown state; no member data leak.
- `/e/[eventId]` — public event info for events marked public.
- `/login` — sign-in, no public registration.
- `/invite/accept` or equivalent callback/setup route — Supabase invitation completion and first-run setup.
- `/auth/callback` — secure Supabase callback/code exchange; validate local/allowlisted redirects.

### Member (authenticated)

- `/dashboard` — points, stars, recent activity, upcoming event, redemption shortcuts.
- `/dashboard/events` — completed attendance and event history, with visibility behavior reflected publicly.
- `/dashboard/rewards` — rewards catalog and request history.
- `/dashboard/id` — authenticated Show ID page with the current active card QR and URL; never embedded on a public profile.
- `/settings/profile` — name, photo, about, links, member-since display/management restrictions.
- `/settings/privacy` — whole-profile and per-field public visibility.
- `/settings/account` — registered email display and authenticated password change. No self-service forgotten-password email workflow in v1.

### Admin

- `/admin` — visually calm operational summary and quick actions.
- `/admin/invites` — invite, resend/cancel where supported, status, safe error states.
- `/admin/members` and `/admin/members/[id]` — search/filter, status, profile visibility preview, member activity, suspend/reactivate with reason.
- `/admin/cards` — issue, write, verify, revoke, replace, show card status and write-job history.
- `/admin/events` and `/admin/events/[id]` — create/edit main events and bonus sessions, configure duration/points, activity options, event public visibility.
- `/admin/kiosk` — pending scan queue, active event/session, two lane statuses, photo validation, check-in/out/deny, recent confirmations.
- `/admin/points` — ledger search, manual award/adjustment with reason, no destructive edits.
- `/admin/rewards` and `/admin/redemptions` — catalog, inventory, request transitions, refunds.
- `/admin/devices` — allowlist, lane labels, enrollment/revocation/key rotation, last seen/firmware state.
- `/admin/audit` — filterable, read-only audit events.
- `/admin/support` — recovery-link issuance and support tracking.

### Device API (server-only and versioned)

Use explicit versioning such as `/api/device/v1/...`. Every device endpoint verifies the per-device request signature and allowlist status before doing anything.

- `POST /api/device/v1/scans` — submit a parsed card URI/token and a device-generated unique request ID. Returns accepted/duplicate/rejected status, never point balances or admin secrets.
- `GET /api/device/v1/commands/next` — authorized device retrieves its next pending write/diagnostic command; return no-op when idle. Poll at a conservative interval and back off on errors.
- `POST /api/device/v1/commands/:commandId/result` — report card write/read-back outcome and firmware diagnostics.
- `POST /api/device/v1/heartbeat` — report uptime, firmware version, reader readiness, and last successful API contact. Do not send campus passwords or personally identifying Wi-Fi details.

Do not expose a general database proxy or a device endpoint that can choose an arbitrary member, event, points value, or arbitrary URL to write. Device inputs have strict maximum lengths and schemas.

## 7. Data model and database invariants

Create versioned Supabase migrations for every schema change. Exact names may vary, but all listed concepts and invariants must exist.

### 7.1 Core tables

- `members`: internal UUID, `auth_user_id` nullable/unique until activation as appropriate, normalized email for pending invite matching, membership status, paid/verified timestamp and actor (manual admin-entered confirmation), invite status, created/updated timestamps. Never put passwords here.
- `profiles`: member FK, random `public_profile_id`, random non-secret public member code, display name, avatar storage key, about, links, member-since, profile-wide visibility, per-field visibility flags, timestamps.
- `member_roles`: Auth user FK, role/permissions, actor and timestamps. Role assignments are server/admin controlled only, never writable via member self-editable metadata.
- `invitations`: member FK, email, state, invited_by, sent/accepted/cancelled/expired timestamps, provider-safe reference/error metadata. Never store raw invite or recovery tokens.
- `cards`: member FK, random card token/locator, status (`write_pending`, `active`, `revoked`, `failed` as appropriate), medium (`physical`, `virtual`), issued/revoked timestamps, operator/device, superseded-card relation, audit fields. Card locators are not login credentials; never expose them via normal profile API responses.
- `events`: identity, title, public description/image, start/end, timezone, location/links, visibility, status, creator/audit fields.
- `event_sessions`: event FK, session type (main/bonus), time window, minimum qualifying duration, attendance points, attendance enabled/status, optional overlap policy.
- `attendance`: member/session, check-in and check-out server timestamps, status, validating actors, lane/device metadata, duration, result, unique/open-interval protection.
- `event_activities`: session/event FK, named activity, validated point value, active window, per-member limit/idempotency policy, active flag.
- `point_ledger`: immutable entry ID, member FK, event/session/activity/reward references when relevant, kind, `points_delta`, `stars_delta`, reason, idempotency key, actor, timestamp, safe correlation IDs. Require a reason for manual adjustment.
- `member_balances`: member FK, current spendable points, lifetime stars, updated timestamp; update in the same transaction as the ledger insert. Include a reconciliation test comparing it with the ledger sums.
- `rewards`: name, image key, description, cost, inventory/availability, active state, created/updated actor.
- `redemptions`: member/reward, quantity, point cost snapshot, status, lifecycle timestamps, fulfilling/reviewing admins, reason; state changes and point ledger operations occur transactionally.
- `nfc_write_jobs`: device/lane, card/event resource, safe command payload, status/expiry, created_by and completion metadata. A raw card token is delivered only to the authorized device for the bounded write job and must not appear in ordinary logs.
- `device_registry`: device ID, lane/name, hashed secret or equivalent verifier, active/revoked status, allowed functions, last seen, current firmware version, rotation timestamp, created_by.
- `device_request_nonces`/idempotency records: prevent replay/duplicate submission; apply a bounded retention period.
- `pending_scans`: card locator reference or resolved card/member, lane/device, server timestamp, status, TTL, safe error code. Avoid placing raw tokens in long-retention application logs.
- `audit_log`: append-only security/business actions with actor, operation, entity reference, timestamp, outcome, reason and correlation ID. Do not include passwords, tokens, recovery URLs, device secrets, or unnecessary raw PII.

### 7.2 Database rules

1. Use foreign keys, CHECK constraints, unique constraints, supporting indexes, and transactions—not only TypeScript validation.
2. Exactly one active card credential per member in the default design; replacement revokes/supersedes the prior credential transactionally.
3. `public_profile_id`, public member code, card token, invite identity, and device ID must be independently generated and must never be derived from email, sequential member IDs, or Supabase Auth IDs.
4. A member can update only permitted profile fields on their own profile. They cannot change member status, roles, visibility rules for account email, point balances, stars, card state, ledger rows, event attendance, reward prices, or audit history.
5. Point awards and redemption transitions are implemented as transactional server/database operations with idempotency keys and proper row locking. Concurrent redemptions must not overdraw the balance.
6. A positive point award creates an equal positive `stars_delta`; a spend/redeem/refund creates `stars_delta = 0`. A deliberate administrative correction can change stars only with a reason and audit event.
7. Attendance state transitions are legal only once: absent → checked in → checked out. Duplicate, stale, invalid, or conflicting transitions produce an explicit no-op/error and an audit trail, not duplicate ledger entries.
8. Use server timestamps for the authoritative attendance duration. If the server/database transaction fails, do not optimistically tell the operator attendance or points were saved.
9. Use database functions/RPCs where they make atomic invariants safer. SECURITY DEFINER functions must use a fixed safe `search_path`, restricted execute grants, and reviewed permissions.
10. Keep application-only and privileged tables in a non-exposed schema when appropriate. Do not make a sensitive table public merely because it is easier for the client to query.

## 8. Authentication, authorization, and security requirements

### 8.1 Supabase Auth

- Use the supported Supabase server-side auth pattern for Next.js App Router and cookie sessions.
- Cookies must be server-set with appropriate `HttpOnly`, `Secure` in production, `SameSite`, path, and expiry attributes.
- Protect against invalid return URLs/open redirects in auth callback handling.
- Admin invite/recovery operations use Supabase Auth Admin API only from server code; the service/secret key must not appear in client chunks, source maps, logs, or public env variables.
- Set production site URL, explicit allowed redirect URLs, invitation/recovery templates, expiry policy, and a production mail provider/SMTP before launch.
- Disable self-sign-up in project settings and verify this behavior with an integration test.
- Verify user identity and role on the server for every protected page/API/server action. Middleware or client-rendered role state is only a UX convenience.

### 8.2 RLS and grants

Enable Row Level Security on every table reachable by the Supabase Data API. Explicitly revoke unnecessary grants from `anon` and `authenticated`, then grant back only required operations. Test both grants and policies. Admin bypass credentials remain server-only. Public queries should expose only explicit safe view/query fields, never `select *` over private tables.

Required authorization matrix tests:

- Anonymous visitor can read only public profile fields, public events, enabled leaderboard rows, and public avatar bytes when allowed.
- Anonymous visitor cannot enumerate private members, read email when its visibility flag is off (or when the whole profile is private), see non-public points/stars/event history, query card tokens, or read pending scans.
- Member A cannot read or change Member B's private profile, ledger, balance, redemptions, card token, or event history unless the member explicitly made supported fields public.
- A member cannot elevate their role, invite another member, write ledger rows, create an admin, confirm a kiosk scan, or change device configuration.
- Admin-only functions require the right server-verified role.
- A revoked card URL does not redirect and does not identify the member to unauthenticated clients.
- A revoked or unknown device key cannot submit scans or fetch write jobs.

Use `supabase test db`/pgTAP and application integration tests for both allowed and denied paths. RLS failures are release blockers.

### 8.3 Device request signing

Use per-device HMAC-SHA-256 signatures over a canonical request string that includes at least HTTP method, normalized path, timestamp, unique request ID/nonce, and SHA-256 of the exact request body. Send device ID, timestamp, request ID, and signature in explicit headers. The API must:

- require HTTPS and validate the request signature in constant time;
- enforce a narrow timestamp skew window and reject used nonces/request IDs;
- enforce per-device rate limits, body-size limits, exact endpoint/function permissions, and strict schemas;
- support rotation and immediate revocation per device;
- ensure requests cannot be replayed to cause duplicate scans/commands;
- return minimal error messages that do not leak database data;
- never accept `points`, `member_id`, a database role, arbitrary callback URL, or an arbitrary command from a reader device;
- avoid logging full signatures, secrets, card tokens, or recovery links.

Use TLS certificate verification on ESP32. Provision a trusted root/CA bundle appropriate to the chosen ESP32 framework and deployed API. Never use insecure TLS modes in production.

### 8.4 Rate limiting and abuse resistance

Apply rate limiting to login-related endpoints where feasible, invite/resend operations, public profile/avatar requests, admin actions, device API requests, and support recovery operations. Prefer a reliable shared store or platform-appropriate rate-limiting mechanism for production; don't pretend an in-memory counter is globally reliable across serverless instances. If rate-limit infrastructure requires a new external account/key, document the needed secret and ask the user before production rollout; use a testable local adapter for development.

### 8.5 Files, logs, privacy, and headers

- Validate uploads by MIME sniffing and actual image decoding; reject oversized or malformed files; re-encode to remove EXIF/metadata.
- Use a private Storage bucket for member photos; only return photo bytes through a privacy-aware endpoint.
- Add security headers: a sensible Content Security Policy, `Referrer-Policy`, `X-Content-Type-Options`, frame-ancestor protections, strict transport security in production, and a minimal permissions policy.
- Never put tokens in URLs beyond the deliberately public card locator. Redact all auth tokens, cookies, passwords, recovery URLs, device signatures/secrets, and unnecessary PII from logs and test snapshots.
- Add CSRF/origin protections appropriate to chosen server actions/API routes and use safe cookie settings.
- Record admin activity, auth/security outcomes, device state transitions, attendance validation, point awards/redemptions, card revocation, and profile visibility changes. Audit rows are append-only from application roles.
- Provide a data export/deletion/retention operations note. Do not delete ledger history as a side effect of member deactivation.

## 9. Material 3 Expressive UI requirements

### 9.1 Visual language

Implement a cohesive Material 3 Expressive-inspired system with semantic color roles and a robust light/dark mode. Use expressive typography, clear component hierarchy, intentional shapes, tasteful transitions, generous touch targets, and strong contrast. The UI should look professional on both a phone at an event and a desktop admin workstation.

Required tokens: primary/on-primary, secondary/on-secondary, tertiary, surface/container tiers, background, outline, error, success/warning status roles, scrim, focus ring, typography scale, spacing scale, shape scale, elevation, and duration/easing/reduced-motion behavior. Do not use raw arbitrary hex/radius/shadow values throughout app code. Exceptions must be added to the shared token system.

Use a clear hierarchy:

- Public hub: image-led or shape-led hero, compact leaderboard, visible upcoming-event tiles, a small set of top metrics, almost no paragraphs.
- Member profile: portrait, name, concise about/links, strong point/star counters, compact activity/event visuals, privacy-safe fields only.
- Member dashboard: current points balance and lifetime stars are the two most visible numbers; event history and rewards are scannable.
- Admin desktop: practical table/list layouts with filters and search, but simplify to stacked rows/cards on small screens; primary operational actions remain easy to reach.
- Kiosk: high contrast, very large action targets, prominent photograph/name and current state, clear success/error feedback, no dense menus. Confirm/deny actions must be visually distinct but never depend on color alone.

Use photos, illustrations, and real event imagery only when supplied or permissively licensed. Do not fake GDG@PSU/Google logos. If an official logo/brand asset is unavailable, use a refined typographic wordmark and abstract design motif, and ask the user only if the final brand asset is essential.

### 9.2 Responsive and accessible behavior

- Mobile-first; support 320 CSS px width without horizontal scrolling, as well as common phone, tablet, laptop, and large desktop widths.
- A responsive navigation pattern: compact mobile navigation and appropriate desktop navigation/sidebar/rail; no desktop-only hover dependency.
- Every interactive control works with keyboard and screen readers; meaningful labels/announcements; visible focus; focus return for dialogs; accessible table/list semantics.
- Target WCAG 2.2 AA contrast and focus behavior. Use semantic HTML, descriptive error messages, and programmatic form labels.
- Respect reduced-motion preferences; don't use motion for essential state communication.
- QR can be zoomed, keyboard-accessible alternative URL shown, and the code must have enough quiet zone/contrast and a tested render size.
- Avoid destructive actions that can be completed with a single accidental click; confirm revoke, refund, suspend, and admin role changes.

### 9.3 Design-system enforcement

Create a short `docs/design-system.md` with token semantics, component rules, responsive breakpoints, and examples. Build reusable components for buttons, fields, chips/status, cards, dialogs, tabs, profile header, points/stars summary, avatars, empty states, loading/skeleton states, error/success states, tables, and QR display. All app UI should consume these components/tokens. Do not ship unstyled stock components mixed with the design system.

## 10. API and domain behavior

Create a centralized domain layer for validation and business rules. Route handlers/server actions should be thin and call domain services with explicit actor context. Keep all server-only modules marked/organized so they cannot be imported into client components.

Required service operations include:

- `inviteMember` / `resendInvite` / `cancelInvite` with idempotent state transitions;
- `completeMemberActivation`;
- `updateOwnProfile` and `updatePrivacySettings` with an allowlist of editable fields;
- `issueCard` / `completeCardWrite` / `revokeCard` / `replaceCard`;
- `resolveCardUrl` for `/c/...` redirect behavior;
- `registerDeviceScan` and `confirmPendingScan`;
- `checkIn` / `checkOut` / `dismissScan`;
- `awardActivityPoints` / `adminAdjustLedger`;
- `requestRedemption` / `approveRedemption` / `fulfillRedemption` / `rejectOrCancelRedemption`;
- `createEvent` / `createSession` / `configureActivity`;
- `generatePasswordRecoveryLink` with safe sending/status tracking;
- `registerDevice` / `rotateDeviceSecret` / `revokeDevice`;
- `reconcileMemberBalance` and operational health checks.

Use a single canonical implementation of point, stars, attendance, privacy, and role rules. Do not duplicate business logic in React components, firmware, and route handlers. Firmware handles tag I/O, request signing, retries, local bounded buffering, and device-health state; the server remains authoritative.

## 11. Firmware requirements

### 11.1 Device identity and provisioned configuration

Each ESP32 is built/configured with a non-secret device ID plus a unique secret. The raw secret is provisioned from an ignored local header or secure build environment and is never committed. Provide `secrets.example.h` with nonfunctional placeholders and `.gitignore` entries for actual secrets/build artifacts. The API administrator can enroll/revoke a device and label the two lanes.

If a secret is compiled into firmware, acknowledge that physical access can extract it; therefore use per-device least privilege, request signing, narrow endpoint scope, and revocation. Do not claim the embedded secret is tamper-proof.

### 11.2 NFC format

- Member card: one HTTPS NDEF URI: `https://member.gdgpsu.dev/c/<card_token>`.
- Event-info card (if issued): one HTTPS NDEF URI: `https://member.gdgpsu.dev/e/<public_event_id>`.
- No raw UID as account identifier, no member data, no points, no Wi-Fi credentials, no password, no device ID/secret, and no bearer session tokens in NDEF.
- Use supported URI records and validate the exact tag's capacity/protocol. Write flow must read back the record and compare the expected URI byte-for-byte before reporting success.
- Do not depend on NFC UID uniqueness or anti-cloning.

### 11.3 Robust firmware behavior

- Initialize PN532 and report a healthy/unavailable reader state to the API.
- Debounce a card held near the reader; do not create a scan every loop iteration. Require card removal or a configurable quiet interval before accepting the same tag again.
- Parse NDEF URI records defensively; reject malformed URLs, unexpected hostnames, unexpected paths, oversized payloads, and non-HTTPS URIs. Extract only the expected token/ID.
- Never follow the URL from the tag on-device. Never fetch the profile page. Send the parsed locator to the known API origin only.
- Give each scan/command a unique idempotency ID; retry transient failures with exponential backoff and jitter; no infinite busy loops.
- Use bounded local persistence for brief network outages. Queued scans are observations only and are never auto-confirmed; avoid unbounded storage of card tokens. Surface queue age/capacity, offline state, and duplicate/retry status. On reboot, preserve IDs for queued records so retries remain idempotent.
- Handle HTTP status codes, malformed responses, timeouts, clock issues, Wi-Fi disconnect/reconnect, DNS failures, TLS errors, reader errors, low-memory state, and full queue explicitly.
- Log no credentials or full card tokens over serial in production builds; provide a deliberate development-only verbose mode.
- Support a device health heartbeat and firmware version. Firmware update/OTA is not required for v1 unless the chosen deployment demands it; document the safe manual update route.

### 11.4 Campus network

The supplied Seneca Engineering eduroam tutorial is useful background, but its campus-specific credentials/configuration are not authoritative for Penn State. Before deploying hardware on campus, confirm the Penn State-approved network/EAP method, identity format, CA/server-certificate validation, and whether IoT devices are permitted. Never put a member's personal PSU password in a public repo or shared device image. If PSU requires a device onboarding process, use it; do not silently substitute an insecure/open network or disable certificate validation. The agent can implement configurable WPA2/WPA3-Enterprise settings and a mock/network diagnostic, but a real campus authentication test requires the user/PSU IT and the actual device.

## 12. Environment variables and secrets

Create `.env.example` with names, descriptions, and non-working placeholders only. Validate server variables at process startup and fail with actionable messages. Expected variables are likely to include:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` or the current supported publishable key name
- `SUPABASE_SERVICE_ROLE_KEY` or the current server-side secret key, never exposed to the client
- production mail provider configuration if not fully handled by Supabase Auth SMTP
- optional shared rate-limit provider settings if required for production
- development/test-only seed/bootstrap configuration that is not enabled in production by default

Do not hardcode a user email as admin in the source. Provide a one-time, explicit bootstrap script that promotes a confirmed existing Supabase Auth user to the first admin, with careful usage instructions and idempotency. If a required secret is absent, local code/tests should still run against mocks/local Supabase where feasible; production deploy steps must clearly remain blocked until the user supplies it.

Firmware configuration has its own ignored local secrets/config file and documented fields for API origin, device ID, device secret, board type, PN532 interface/pins, and trusted CA configuration. Commit examples only.

## 13. Testing strategy and release gates

“Works perfectly on the first try” is an aspiration, not a promise. Treat every gate below as required. Fix failures instead of weakening assertions, skipping tests, swallowing errors, or claiming unverified success.

### 13.1 Static and unit checks

- Formatting and lint checks for all source/config/SQL/firmware code.
- TypeScript strict typecheck; no unexplained `any`, unsafe casts, disabled lint rules, or blanket ignores.
- Unit tests for public ID/card token generation constraints, URL parsing, privacy projection, role/permission checks, points/stars algebra, duration thresholds, event state transitions, redemption transitions, idempotency, and device signature canonicalization.
- Property/invariant tests: points never become negative; stars only change on earning/admin correction; replays never duplicate ledger entries; one active attendance interval per member/session; a revoked card never resolves; a private profile never leaks protected fields.
- Firmware unit tests for NDEF parsing, URL validation, debounce, retry/backoff and idempotency construction, HMAC canonicalization, and queue bounds where the selected framework supports host tests.

### 13.2 Database/RLS tests

- Start a local Supabase stack where Docker/environment support permits.
- Apply all migrations from an empty database and seed only test data.
- Run `supabase test db`/pgTAP with positive and negative tests for every policy/privilege boundary.
- Test concurrent redemption requests and duplicate attendance commands using separate database transactions/clients.
- Verify `member_balances` equals the derived ledger sums and that every business operation can roll back without partial writes.
- Verify activation is idempotent and no public profile ID/card token exists before invite acceptance.
- Verify SQL functions have restricted grants, a fixed `search_path` when SECURITY DEFINER, and no unintended `anon`/`authenticated` access.

If the environment lacks Docker or local Supabase prerequisites, do not mark these tests passed. Run all available checks and record the exact blocker and one-command instructions for completing the remainder.

### 13.3 API/integration tests

Test invitation creation/errors, callback tampering, duplicate activation, account role denial, own-profile edits, email privacy, public profile projections, private avatar responses, expired/revoked card routes, device signature mismatch, unknown/revoked device, stale timestamp, replayed nonce, oversized payload, invalid URL, request rate limiting, duplicate scan retry, pending scan expiry, event selection races, check-in/out edge cases, minimum duration, no checkout, activity caps, reward race/overspend, refund consistency, and audit logging.

### 13.4 Browser end-to-end tests

Use Playwright with seeded fake users (at least anonymous, two separate members, and admin) and a local/mock Supabase environment where possible. Cover:

1. Admin invites a user; invited user accepts, sets a password, completes name/photo setup, and gets a permanent profile URL only after activation.
2. User cannot sign up without an invitation or navigate to admin actions.
3. Member changes profile and privacy, and another browser/session sees only allowed public fields.
4. Public leaderboard excludes members who made the relevant metric private.
5. Member dashboard shows correct points/stars after award, redemption, refund, and history refresh.
6. Admin creates an event/session, records a check-in and check-out through simulated device scans, confirms the photo, and calculates points correctly.
7. Missing checkout earns no points; short valid attendance follows the configured threshold rule.
8. Repeated device webhook/request does not duplicate attendance or points.
9. Admin issues/revokes a card; active `/c/` redirects, revoked `/c/` stops, and `/m/` remains stable.
10. Digital ID QR is only accessible to its owner and has an accessible URL alternative.
11. Password reset link generation is admin-only and no raw link is present in logs.
12. Redemption races cannot overspend.
13. All forms show loading, empty, validation, success, and error states.
14. Mobile viewport, keyboard-only navigation, accessible dialogs, reduced-motion behavior, and basic WCAG checks pass.

### 13.5 Responsive visual quality

Capture and inspect representative screenshots at minimum 320, 375, 768, 1024, and 1440 CSS pixels for public home, profile, member dashboard, privacy settings, admin members, events, and kiosk. Fix overflow, clipped content, misaligned controls, poor contrast, placeholder-only labels, tiny touch targets, and inconsistent components. Run accessibility tooling (axe or equivalent) in E2E for important views. Add a reasonable performance budget; avoid large animation or image assets that impair kiosk/mobile use.

### 13.6 Firmware and hardware validation

- Run PlatformIO compile for every documented target/environment.
- Run supported host/native unit tests and mock API protocol tests.
- Verify TLS/HMAC canonical request behavior against shared test vectors used by server and firmware.
- Provide a hardware verification checklist for actual PN532 read/write, read-back, repeated tag debounce, device enrolment, reader unplug/reconnect, Wi-Fi drop/reconnect, API outage and queue recovery, revocation, two simultaneous lanes, and card replacement.
- The agent must state clearly which tests were run on a real device and which were simulated. Real ESP32/PN532/tag and Penn State network tests require actual hardware/network access.

### 13.7 CI

CI should run format, lint, typecheck, unit tests, migration/SQL tests where supported, API integration tests, E2E smoke tests, firmware build/tests, and dependency/security checks. Use lockfile-frozen installs. Fail the pipeline on a test failure. Secrets belong in CI/Vercel secret stores and are never committed.

### 13.8 Required final verification command

Provide one well-documented root command such as `pnpm verify` that runs every locally runnable validation gate in a deterministic order, reports each gate, and exits nonzero on failure. Provide separate explicit commands for local Supabase startup/reset/seed, E2E, firmware builds/tests, and production preflight. Do not make `verify` silently skip missing dependencies; report a visible blocked/skipped gate with reason and nonzero status for required release validation.

## 14. Git and repository hygiene

- Inspect whether the target directory already has a Git repository before changing anything. Do not overwrite or reset a user's existing history/worktree.
- If no repository exists, initialize Git with a clean default branch and `.gitignore`, `.editorconfig`, license/notice policy if needed, and meaningful documentation.
- Use focused, comprehensible commits that represent the actual work (for example: scaffold, database/security, flows, firmware, test/docs). Do not manufacture a commit identity, do not amend/rewrite an existing user's history without consent, and do not add AI co-author/AI-generated attribution trailers or statements to commit messages. Preserve whatever author identity is configured.
- The user requests temporary Git signing disablement for initial setup. Implement this safely at **repository-local scope only**: inspect current local/global `commit.gpgsign` and relevant tag-signing settings, save the exact prior local state, temporarily set the local override to false only for the required setup commits, then restore the prior local value or remove the override so the global/user configuration resumes. Do not change global signing configuration and do not leave signing disabled. Report the final state. If the environment's commit-signing policy is enforced externally, do not fight it; proceed without unsafe configuration changes and report the limitation.
- Never commit `.env`, service-role/secret keys, ESP32 secrets, PSU credentials, real member email lists, user photos, production exports, recovery URLs, or generated binaries containing secrets. Use `.env.example` and firmware secret examples only.
- Do not push to a remote, create a public repository, configure a paid service, or mutate production data without explicit permission and available credentials. Local project creation and local tests can proceed autonomously.
- Check `git diff`, `git status`, secret scan results, and ignored files before every commit. Do not add misleading “AI wrote this” attribution lines. Do not falsify authorship or bypass a host-mandated attribution mechanism; simply do not add extra attribution yourself.

## 15. Operational documentation required

The resulting repository must include a README and focused runbooks:

- `docs/architecture.md` — components, request/data flow, trust boundaries.
- `docs/design-system.md` — Material 3 Expressive tokens and usage rules.
- `docs/development.md` — toolchain, install, local run, test, reset/seed, firmware commands.
- `docs/deployment.md` — Vercel project settings, domain/DNS, Supabase production config, migrations, environment variables, backups/rollback, CI/CD.
- `docs/security.md` — roles, RLS, secrets, card cloning caveat, device signing, incident response, privacy.
- `docs/operations.md` — invite member, issue/write/replace/revoke card, create event/bonus session, kiosk runbook, reward fulfillment, member support.
- `docs/hardware.md` — approved ESP32 board, PN532 interface/pinout, compatible tag, power/wiring, PlatformIO configuration, flash instructions, test procedure; unknown model-specific facts must be explicit TODOs and must block claiming hardware-tested.
- `docs/campus-network.md` — PSU IT confirmation checklist, approved EAP method and CA validation, secure credential storage, connectivity diagnostics.
- `docs/testing.md` — verification commands, test coverage, local prerequisites, known external tests.
- `docs/decision-log.md` — any material decisions or user-approved changes from this plan.

README should give a concise product overview, architecture, screenshots if produced, requirements, local setup, common commands, and links to the detailed docs. Do not bury setup instructions in a giant wall of text.

## 16. External setup and user intervention checklist

The agent should do all local work it can, using placeholders or mocks. It must not claim production readiness until the relevant items are supplied and verified.

1. **Supabase project:** project URL and publishable key, server-only secret/service key, production Auth settings, allowed redirect URLs, migrations, storage, and initial-admin bootstrap. Ask the user to provide/enter secrets through a secure environment rather than putting them into chat or source files.
2. **Production email:** Supabase custom SMTP/email provider credentials and verified sending domain, invitation/recovery/card-ready templates, delivery testing. Without this, local invitation tests can use local email capture; production invitation delivery is blocked.
3. **Vercel/domain:** access to the right Vercel team/project, DNS control for `member.gdgpsu.dev`, environment variables, and production deployment approval. The agent may prepare the config but must ask before making production changes or spending money.
4. **First admin:** the user must identify the actual intended admin email and run/authorize the explicit bootstrap; the agent must not guess a personal email or hardcode it.
5. **Real hardware:** exact ESP32 board revision, PN532 breakout/interface (I2C/SPI/UART), wiring/pins, and the actual NFC tag model/capacity. The agent can make the interface configurable and write tests, but must ask before asserting a physical wiring recipe for unknown boards/tags.
6. **Penn State network:** confirm through PSU IT whether the planned board is authorized on eduroam/another approved network, the allowed EAP method/identity format, and the correct CA/certificate verification configuration. The linked Seneca tutorial is not a PSU-specific configuration authority.
7. **Club operations:** confirm or use documented safe defaults for membership-fee verification, point values/duration thresholds, reward catalog/inventory, public event details, privacy language, retention/support procedures. Keep these configurable; do not make up real club policies or real award values. Include test fixture defaults only in seed/demo data.
8. **Brand assets:** official club logo, approved colors, event photos, and any image rights. If absent, use a polished text/abstract visual language without fabricating official marks.

If the user cannot supply an external account/credential or the agent lacks the capability (campus Wi-Fi, physical hardware, domain DNS, sending email, production dashboard), stop at the nearest safe gate, explain exactly what is blocked, and give the smallest set of concrete steps required. Do not substitute an inferior unapproved service or unsafe networking workaround.

## 17. Definition of done

The project is done only when all locally verifiable criteria below are true and any external blocker is explicitly reported:

- [ ] Full repo exists with `PLAN.md`, `PROMPT.md`, README, docs, source, migrations, tests, and a clean Git status after commits.
- [ ] Stable `/m/` profiles and revocable `/c/` card URLs follow the lifecycle in this plan.
- [ ] Supabase Auth is the only password system; no password fields/hashes exist in app tables.
- [ ] No self-registration; admin invitation and first-run setup are implemented and tested.
- [ ] Server-side auth checks and RLS/grants prevent cross-member data access and privilege escalation.
- [ ] Public profile and leaderboards obey profile/field/metric visibility. Email follows its disclosed member-controlled visibility setting; QR, Auth IDs, card tokens, and device secrets are never public.
- [ ] Points ledger, lifetime stars, attendance, activity awards, redemptions/refunds, audit logging, and balance reconciliation are transaction-safe and tested.
- [ ] Missing checkout awards no points; duration threshold and bonus session behavior are tested.
- [ ] Two separate authenticated device identities are supported. A scan cannot award points without staff confirmation.
- [ ] Card issue/write/read-back/revoke/replace logic is implemented, with old-token revocation and stable profile URL behavior tested.
- [ ] ESP32 firmware contains no Supabase credentials, no hardcoded personal PSU credentials, no insecure TLS, and has bounded retries/queue behavior.
- [ ] Material 3 Expressive tokens/components are consistent across public/member/admin/kiosk pages; UI is responsive and accessible.
- [ ] Unit, database/RLS, API, E2E, firmware build/test, and responsive visual gates pass wherever the required environment exists. Unavailable gates are precisely documented—not falsely marked passed.
- [ ] `pnpm verify` and all other documented commands work from a clean checkout in the stated environment.
- [ ] Deployment/email/hardware/network setup docs give actionable steps without exposing secrets.
- [ ] Git signing configuration is restored to its prior effective state; no secrets or extra AI attribution are committed.
- [ ] Final report lists architecture, significant security choices, tests run with exact results, external steps still required, and any limitations honestly.

## 18. Reference documentation

Use current official documentation and verify API/version details against the version selected during implementation. These references informed the architecture; they do not replace reading the current docs.

- Supabase Auth users/invitations: https://supabase.com/docs/guides/auth/users
- Supabase Admin `generateLink`: https://supabase.com/docs/reference/javascript/auth-admin-generatelink
- Supabase Auth email templates: https://supabase.com/docs/guides/auth/auth-email-templates
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Next.js App Router: https://nextjs.org/docs/app
- Next.js authentication guidance: https://nextjs.org/docs/app/guides/authentication
- Vercel monorepos: https://vercel.com/docs/monorepos
- ESP-IDF Wi-Fi Enterprise/security guidance: https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/wifi-security.html
- Adafruit PN532 library (I2C/SPI and tag operations): https://github.com/adafruit/Adafruit-PN532
- Supplied eduroam background tutorial (Seneca-specific; not PSU authority): https://senecaengineering.org/tutorials/connecting-esp32-to-eduroam/
- Material 3 design guidance: https://m3.material.io/
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

---

**Agent instruction:** Build to this spec end-to-end. Prefer a complete, well-tested vertical slice to a large number of decorative but nonfunctional pages. Every visible button must do what it claims, and every sensitive operation must be enforced on the server/database side.
