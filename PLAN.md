# GDG@PSU Member, NFC, Points & Event System — Build Plan

> **Status:** implementation specification for an AI coding agent. This document defines product behavior, system boundaries, engineering choices, security rules, tests, and release gates. It is deliberately stricter than a typical feature brief: do not claim a gate passed unless it was actually run and its result recorded.
>
> **Primary host:** `member.gdgpsu.dev` (DNS/Vercel ownership and credentials are external prerequisites).
>
> **Primary support contact:** `gdg@psu.edu`.
>
> **Date checked:** 2026-10-27. Dependencies must be resolved to compatible stable releases and locked at implementation time; do not blindly use prereleases or stale version numbers.

## 1. Product vision

Build a polished, responsive member identity and engagement portal for GDG@PSU. Every paid member is invited by an administrator, accepts the invitation, sets a password using Supabase Auth, completes a required name/photo setup, and receives a permanent opaque profile URL. A later-activated NFC card contains only a static NDEF URL under `/c/`; that URL redirects to the member's permanent `/m/` profile. Lost cards can be revoked without changing the profile URL.

The system includes:

- A public home/leaderboard/events experience with very little text and clear visual hierarchy.
- A member portal to edit a profile, inspect spendable points and non-spendable stars, view eligible event attendance, request merchandise, and reveal an authenticated-only QR fallback for their card.
- An administrator portal for invitations, members, cards, events/sessions, two-lane kiosk validation, rewards/redemptions, device management, password recovery and audit history.
- Two ESP32 + PN532 reader/writer units that use an authenticated HTTPS middleware API only. The ESP32s never connect directly to Supabase/Postgres.
- A central Supabase PostgreSQL database, Supabase Auth and Storage, and a Vercel-hosted Next.js application/API.

The target is production-quality implementation, not an attractive mockup. Every visible action must work end to end or be explicitly shown as unavailable until a real prerequisite is configured.

## 2. Product decisions and invariants

These rules are authoritative. If implementation finds a genuine contradiction that materially changes privacy, money/points, identity, or hardware behavior, stop and ask the user rather than quietly choosing a worse replacement.

### 2.1 Member identity and URLs

- Members do **not** choose usernames. After a valid invitation is accepted, generate a cryptographically random, unguessable public profile slug and create a stable URL: `https://member.gdgpsu.dev/m/<profile-slug>`.
- NFC cards use a separate, opaque card URL: `https://member.gdgpsu.dev/c/<card-token>`. `/c/<card-token>` resolves the currently active card credential and redirects to `/m/<profile-slug>`. Do not encode an email, Supabase UUID, visible member number, role, points, or other personal data in the URL.
- Profile URL and card URL have distinct lifecycles. A member profile URL remains unchanged when a card is lost, revoked or replaced. Only a card token may be rotated/revoked.
- No public `/m/` profile or active `/c/` token is created before invitation acceptance. A pending Auth invitation may exist inside Supabase Auth, but the application must not publish member profile/card records until the member completes setup successfully.
- After acceptance, the member profile is available at `/m/`; a card token is created/activated when an administrator prepares the card for writing. Until then, show a clear “Card not issued yet” status in the member portal.
- Use at least 128 bits of cryptographically random entropy for public slugs and at least 256 bits for card tokens. Store a SHA-256 hash of active card tokens, not their plaintext. If the writer needs the plaintext, pass it only through a short-lived, one-use, encrypted write job; erase that payload on completion/expiry. Do not log card tokens.
- `/c/` is a public profile-routing token, **not** authentication. Possession of it never authorizes check-in, check-out, point awards, redemptions, account access, or administrative actions.
- The card stores one NFC Forum NDEF URI record only. The card must not store name, email, member number, points, password material, Wi-Fi details, device API keys, or any other personal/authentication data.
- Do not use the NFC chip UID as the member credential. UIDs can be copied/emulated on some hardware; the application uses the opaque `/c/` token parsed from NDEF and validates the transaction on the server.

### 2.2 Invitation and account lifecycle

1. An authorized admin records that dues have been paid and creates an invitation for the supplied email (and membership-since date). Payment processing is out of scope: do not collect payment-card data.
2. The application sends an invitation through Supabase Auth using the configured production email delivery service. Invitation creation is server-only and idempotent; duplicate pending invitations for the same normalized email are prevented.
3. The member opens the time-limited Auth invitation, establishes a session through the supported Supabase PKCE/SSR flow, sets a password, and completes mandatory display-name and photo fields.
4. In one server/database-controlled completion flow, mark the invitation accepted, create the member/profile record and permanent `/m/` slug, create the pending card-issuance state, and set `member_since` from the admin-recorded paid/enrollment date. The operation must be safe against double-submits/retries.
5. The member is signed in and lands on a welcoming setup-complete/dashboard view.
6. Admin prepares/writes the NFC card at an available ESP32/PN532 station. When a successful write is confirmed, the card changes to `issued` and an email is sent that the card is ready. Never email credentials or the card token.

Use Supabase Auth for passwords/session management. The application database must never store a password or password hash. Password-reset UI for members tells them to email `gdg@psu.edu` from their registered email. Admins can initiate a Supabase recovery email/link from the admin portal; do not expose recovery tokens in logs or routine admin tables.

### 2.3 Public/private profile behavior

- Public profiles are public by default after the member completes setup, as requested. Members can switch the entire profile to private and can toggle profile fields/sections independently.
- Default-public profile fields: display name, profile photo, about text, personal links, member-since date, public member number, points, stars and event summary/history—each with its own visibility setting.
- Privacy-sensitive account email is **private by default** and is never exposed in public-profile/leaderboard APIs unless the member explicitly opts into showing it. Internal Auth ID, admin notes, invitation state, card-token data and audit metadata are never public.
- QR is never shown on a public profile. The “Show ID” control is only available to the authenticated member and renders a QR for their current active `/c/` URL. Explain that it is a fallback for staff-assisted identification, not a secret or authentication method.
- Provide a privacy settings screen with a live public-profile preview and a one-click “Make profile private” control. A private profile route shows a neutral private/unavailable state without leaking email, points, events, card status, or internal identifiers.
- Leaderboard membership requires both `show_points = true` and `show_on_leaderboard = true`, and the profile must be public. Toggle defaults should follow the requested public-by-default experience, while email remains private unless explicitly enabled.
- Every public API/query must use an explicit public-field allowlist; never serialize an entire database row or Auth user object into a public response.

### 2.4 Points, stars, attendance and merchandise

- **Points** are spendable. **Stars** are a non-spendable lifetime participation tally: every positive reward grant awards the same number of stars as points, while spending points never reduces stars. A documented admin correction may reverse a mistaken grant in both ledgers. Redemption is points-only.
- Both are ledger-derived. Never update a numeric balance directly from a client or accept a client-supplied post-transaction balance. Use server/database transactions and immutable ledger entries with reversal entries instead of editing/deleting financial-style history.
- Attendance points are awarded only after a verified check-in **and** a verified check-out, and only if the server-calculated duration meets the configured session threshold. No checkout means no attendance points or stars. A member can contact `gdg@psu.edu` from their registered email to resolve an attendance error; the UI should make this support path visible.
- Events contain a main session and may contain optional bonus sessions (for example, an after-event study session). Each session configures a minimum duration and reward. The member earns each session's reward only if they check in and out of that session and qualify. Bonus-session attendance must not be inferred from main-session attendance.
- In-event “small wins” or interactions can be awarded by an authorized admin using a searchable member picker, a positive point amount, a reason, and optional session/event link. Points and stars are granted atomically by default. Every adjustment is audited.
- An event counts in the profile's attended-event history only after the qualifying primary session is completed. Show separate session details only according to visibility preferences. A missed checkout must not quietly count as attended.
- Admin can configure a rewards/merchandise catalogue with price in points and optional inventory. Members can request redemption. Reserve/deduct points atomically when the request is accepted/placed; a cancelled/rejected request gets an explicit compensating ledger transaction. Prevent negative balances, overspending in concurrent requests, duplicate processing and overselling stock.
- Preserve the rule values used for a completed attendance/reward in ledger metadata so later edits to an event configuration do not silently recalculate historical rewards.
- Attendance exceptions/corrections are admin-only, require a reason, record actor/time/old and new state, and are visible in the audit log.

### 2.5 Kiosk and two-lane hardware behavior

- Each ESP32 has a unique public device ID **and a separate, high-entropy per-device secret**. ID alone is not authentication. Keep each secret out of Git and provide it only through a local ignored firmware secrets file/build environment. Store only a verifier/hash server-side; allow disable/rotation per device.
- Firmware talks only to narrow versioned middleware endpoints over HTTPS with certificate validation. It never talks to Supabase directly and never possesses Supabase keys, service-role keys, member emails, or the whole member database.
- A scan sends only the parsed, expected-domain `/c/` token plus device ID, a client-generated idempotency key, firmware version and minimal diagnostics. The server resolves the card token and creates a short-lived pending scan. An authenticated admin kiosk page displays member name/photo/current attendance state and requires a human admin to confirm check-in or check-out.
- Two lanes can be active concurrently. Server-side uniqueness, locking and idempotency prevent two lanes from creating duplicate check-ins, double check-outs, repeated rewards or race-condition overspending.
- A device is assigned/configured by an admin (event/session, lane label, enabled state, writer/kiosk mode). The server allowlists the device. A device cannot pick arbitrary member IDs or event IDs to award points.
- The same reader/writer can prepare a card through an explicitly authorized, one-time write mode: admin queues one write job, inserts the blank/eligible card, firmware writes the one NDEF URI and verifies a read-back, server consumes the job and updates status. Writer mode must not also accept attendance scans. Admin UI clearly shows which physical lane is temporarily unavailable for attendance.
- Firmware parses only URLs matching the exact configured HTTPS hostname and `/c/<expected-token-format>` path. It does not open arbitrary URLs or trust NDEF text as executable/configuration data.
- If the network/API is unavailable, the kiosk shows an unmistakable offline state and does not grant attendance or points offline. Do not buffer untrusted offline attendance and replay it later as verified. Admins may use a clearly labelled, audited manual correction after connectivity returns.
- Use short timeouts, bounded payloads, watchdog/reconnect behavior, `millis()`-safe timing (no long unbounded loops), exponential backoff with jitter, duplicate-scan cooldown, versioned API errors and no secrets/member data in serial logs.

## 3. Stack and repository decisions

Use the following unless a current compatibility/security check proves an equally worthy option is required. Do not substitute a simpler but less capable stack silently.

- **Web and API:** Next.js App Router, React, strict TypeScript, Node.js runtime for database/auth administrative routes, server components for read-heavy pages, route handlers for the public/admin/device HTTP contracts. Deploy to Vercel.
- **Monorepo:** pnpm workspace + Turborepo. One deployable web app and one independently buildable firmware project; use workspace packages only where they create real shared value.
- **Database/Auth/Storage:** Supabase PostgreSQL, Supabase Auth, Supabase Storage. Use `@supabase/ssr` and the current documented cookie/PKCE SSR pattern. Check the current package status/recommended approach while implementing; lock exact stable versions. Use migrations as the schema source of truth.
- **Design system:** Material Design implemented with the current stable MUI component library (`@mui/material`, its matching styling engine, and `@mui/icons-material`). Define one central theme/tokens module and reusable branded wrappers. Do not mix in another component kit, utility-CSS design system, or custom one-off styles that undermine consistency. MUI is a component implementation of Material Design; customize tokens and compositions thoughtfully rather than leaving a stock dashboard theme.
- **Validation/types:** Zod at every server boundary; generate Supabase database types from migrations; share only framework-neutral schemas/types via a workspace package.
- **Forms:** React Hook Form + Zod resolver if current versions are compatible with the installed React/MUI versions; otherwise use a well-tested equivalent and document the reason.
- **Firmware:** PlatformIO with the Espressif Arduino framework (or ESP-IDF only if PN532/NDEF support and the exact board make it demonstrably equal or better). Pin ESP32 platform and NFC libraries. Prove NDEF read/write works with the actual cards before declaring this stable.
- **Tests:** Vitest for domain/unit tests; Supabase CLI/local Postgres and pgTAP (or equivalent SQL integration tests) for schema/RLS; Playwright for E2E; axe-core for automated accessibility checks; a documented hardware-in-the-loop checklist. Use deterministic seeds and an isolated test environment.
- **Code quality/CI:** ESLint, Prettier, TypeScript strict mode, dependency audit, secret scanning (e.g. gitleaks), and GitHub Actions. If CI service access is unavailable, create the workflow and run equivalent local commands; report what couldn't be executed.

### 3.1 Monorepo layout

Use this structure (small adjustments are okay if they keep the boundaries clear):

```text
.
├── PLAN.md
├── PROMPT.md
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── PRIVACY.md
├── LICENSE                  # Ask user before choosing a license if not already present.
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── turbo.json
├── .gitignore
├── .env.example
├── .editorconfig
├── .npmrc
├── apps/
│   └── web/
│       ├── package.json
│       ├── next.config.ts
│       ├── middleware.ts     # Or current Next.js equivalent/proxy convention; verify version docs.
│       └── src/
│           ├── app/
│           │   ├── (public)/page.tsx
│           │   ├── (public)/leaderboard/page.tsx
│           │   ├── (public)/events/page.tsx
│           │   ├── (public)/events/[slug]/page.tsx
│           │   ├── (public)/m/[profileSlug]/page.tsx
│           │   ├── (public)/c/[cardToken]/route.ts
│           │   ├── (auth)/login/page.tsx
│           │   ├── (auth)/invite/accept/page.tsx
│           │   ├── (auth)/auth/callback/route.ts
│           │   ├── (member)/member/page.tsx
│           │   ├── (member)/member/profile/page.tsx
│           │   ├── (member)/member/privacy/page.tsx
│           │   ├── (member)/member/activity/page.tsx
│           │   ├── (member)/member/rewards/page.tsx
│           │   ├── (member)/member/id/page.tsx
│           │   ├── (admin)/admin/page.tsx
│           │   ├── (admin)/admin/invitations/page.tsx
│           │   ├── (admin)/admin/members/page.tsx
│           │   ├── (admin)/admin/members/[id]/page.tsx
│           │   ├── (admin)/admin/cards/page.tsx
│           │   ├── (admin)/admin/events/page.tsx
│           │   ├── (admin)/admin/events/[id]/page.tsx
│           │   ├── (admin)/admin/kiosk/page.tsx
│           │   ├── (admin)/admin/rewards/page.tsx
│           │   ├── (admin)/admin/devices/page.tsx
│           │   ├── (admin)/admin/audit/page.tsx
│           │   └── api/
│           │       ├── public/leaderboard/route.ts
│           │       ├── public/events/route.ts
│           │       ├── admin/.../route.ts
│           │       └── device/v1/.../route.ts
│           ├── components/
│           ├── lib/
│           │   ├── auth/
│           │   ├── db/
│           │   ├── security/
│           │   ├── email/
│           │   ├── profile/
│           │   ├── points/
│           │   ├── attendance/
│           │   ├── cards/
│           │   └── devices/
│           └── theme/
├── packages/
│   ├── ui/                   # MUI theme, tokens, shared branded components
│   ├── contracts/            # Zod request/response contracts and framework-neutral types
│   └── config/               # Shared lint/tsconfig/prettier config only if useful
├── firmware/
│   └── kiosk-reader/
│       ├── platformio.ini
│       ├── include/secrets.example.h
│       ├── include/secrets.h   # Ignored; never commit
│       ├── src/main.cpp
│       ├── lib/                # Small local modules when appropriate
│       └── test/               # Parser/state-machine tests or host-testable core
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   ├── seed.sql                # Local-only demo/test fixtures, never production credentials
│   └── tests/
│       └── database/
├── tests/
│   ├── e2e/
│   ├── accessibility/
│   ├── integration/
│   └── load/
├── docs/
│   ├── architecture.md
│   ├── api.md
│   ├── data-model.md
│   ├── threat-model.md
│   ├── hardware-bringup.md
│   ├── psu-network-validation.md
│   ├── deployment.md
│   ├── operations-runbook.md
│   ├── backup-restore.md
│   ├── test-plan.md
│   └── adr/
└── .github/workflows/ci.yml
```

Use the routing file conventions that match the current pinned Next.js version; the tree illustrates intent, not permission to mix deprecated framework conventions. Every app/API boundary must remain typed and tested.

## 4. Architecture and trust boundaries

```text
Member/Admin browser
  └── HTTPS -> Next.js UI + route handlers on Vercel
                 ├── Supabase Auth (PKCE/cookie session)
                 ├── Supabase Postgres (migrations + RLS + transactional functions)
                 ├── Supabase Storage (profile photos, constrained policies)
                 └── configured email sender via Supabase Auth SMTP/templates

ESP32 Lane A + PN532  ─┐
                       ├── HTTPS + per-device credential -> /api/device/v1/*
ESP32 Lane B + PN532  ─┘           │
                                   ├── validates device and request schema
                                   ├── resolves /c token server-side
                                   ├── creates pending scan/write-job state
                                   └── database transaction + audit log

Admin kiosk browser -> authenticated API -> explicitly confirms scan -> atomic attendance/ledger transaction
```

Trust rules:

1. Browser visibility is not authorization. Every route, server action and API checks current session and server-side role.
2. Public pages use explicit allowlisted data access, not raw table serialization.
3. Supabase `service_role`/secret keys are server-only, never `NEXT_PUBLIC_*`, never in firmware, and never shipped to browser code. Prefer user-scoped SSR clients for member operations; use server-only admin clients only after server-side authorization.
4. RLS is enabled on all application tables accessible through Supabase APIs. Write policies from a deny-by-default starting point. Sensitive write operations still go through narrow server/database functions with authorization and audit.
5. A `security definer` SQL function, if necessary, must use a fixed empty/explicit `search_path`, schema-qualify objects, validate caller/arguments and have minimal grants. Do not use SECURITY DEFINER as a shortcut around RLS.
6. Device API identity is separate from user identity. The device API can only heartbeat, report scans, claim its own authorized jobs, and complete jobs assigned to itself.
7. Public URLs and QR codes are routing identifiers, not authorization factors.
8. Never log passwords, auth tokens, invitation/recovery URLs, full card URLs/tokens, device secrets, email verification codes, or raw photo upload URLs.

## 5. Data model specification

Implement migrations with appropriate foreign keys, unique constraints, check constraints, indexes, timestamps, deletion semantics and comments. Use UTC for stored instants and `America/New_York` for rendering/configuring event times unless the event explicitly requires another timezone.

### 5.1 Identity/profile tables

- `member_invitations`: `id`, normalized `email`, status (`pending`, `accepted`, `expired`, `revoked`), recorded paid/enrollment date, creator admin ID, Auth invitation/user reference where safe, created/expiry/accepted timestamps, optional internal note, audit fields. No raw invitation token. Ensure only one live pending invitation per normalized email.
- `members`: internal UUID, `auth_user_id` unique FK to `auth.users`, immutable/controlled status (`active`, `suspended`, `archived`), public display member number (random/non-sequential token such as `GDG-XXXXXX`), `member_since`, accepted invitation reference, timestamps. Avoid exposing internal UUID in public JSON.
- `member_profiles`: member FK, immutable `profile_slug`, required `display_name`, required `photo_object_path`, optional short `about`, validated social/link list, visibility flags (overall, name/photo/about/links/member number/member since/points/stars/event history/leaderboard/email opt-in), updated timestamp. Enforce content length and link schemes (`https:` only, except explicit `mailto:` if allowed); reject `javascript:`, inline HTML and unsafe data URLs.
- Use a separate private table/view for email and admin-only fields if needed. Do not put email into a broadly readable public-profile table. Role/admin notes are separate from member-editable profiles.
- `user_roles`: `auth_user_id`, role (at minimum `admin`; `member` may be derived from accepted member record), granted by, granted at, optional revoked at. Member clients cannot insert/update role assignments. Admin status must not be inferred from editable profile metadata or from an email suffix.

### 5.2 Card credentials and write jobs

- `card_credentials`: member FK, token hash, status (`pending`, `active`, `revoked`, `lost`, `replaced`), issued timestamp, created/revoked timestamps, previous-card relation and actor/reason. Unique token hash; at most one active card per member unless the product explicitly approves multiple cards.
- `card_write_jobs`: device, member/card target, encrypted short-lived NDEF URL payload, status (`queued`, `claimed`, `written`, `failed`, `expired`, `cancelled`), expiry, claim/attempt counters, one-use nonce, failure code, result metadata. Do not store long-lived plaintext card tokens. Decrypt only on the authorized server/device path and destroy payload as soon as terminal.
- Replacing/lost card revokes the prior token before/atomically with activation of the new one. `/m/` stays the same. Old `/c/` links show a neutral expired-card page (no member metadata) rather than redirecting.

### 5.3 Events and attendance

- `events`: name, slug, summary, location, start/end, published/draft/cancelled/completed status, creator, public visibility and audit timestamps.
- `event_sessions`: event FK, name/type (`main`, `bonus`), start/end, check-in window, check-out window, `minimum_duration_minutes`, reward amount in points (stars mirror reward), enabled status, immutable reward-policy snapshot applied to attendance.
- `attendance_records`: unique member/session attendance unless an explicit supported repeat policy is implemented; check-in/out timestamps; separate validating admin IDs; state; computed duration; qualification result; related reward grant IDs. Enforce valid state transitions in a transaction.
- `attendance_audit_events`: append-only sequence of scan received, check-in confirmed, check-out confirmed, rejection, admin correction and state change with actor/device/time/reason/request ID. Avoid storing card tokens in audit payloads.
- A completed eligible primary session counts the event once in event history; session rewards remain individually traceable. A bonus session does not silently create a second event-attendance count.

### 5.4 Points/stars ledger and rewards

- `point_ledger`: append-only row with member, signed delta, type (`attendance_reward`, `interaction_reward`, `redemption`, `reversal`, `admin_adjustment`), unique idempotency/source reference, description/reason, actor, related event/session/redemption, timestamp and relevant rule snapshot. Balance is the sum in a transaction; a cached balance is optional and must be updated atomically/reconciled against the ledger.
- `star_ledger`: append-only row with signed delta and corresponding source/grant. Positive awards mirror earned points; spends have no star entry; only explicit reward reversals/corrections can reverse stars.
- Expose narrow SQL functions/transactions to grant points+stars, reverse a grant, debit points for a redemption, cancel/release a redemption, and compute balance. Lock the member balance/source rows as needed and check non-negative balance **inside the transaction**.
- `rewards`: name, concise description, image/visual, cost in points, available inventory, active state, fulfillment notes and audit fields.
- `redemptions`: member, reward snapshot, quantity, points reserved/debited, state (`requested`, `approved`, `fulfilled`, `cancelled`, `rejected`), actor/time fields, idempotency reference. Inventory and balance transitions must be atomic and race-safe.

### 5.5 Devices, scans and auditing

- `devices`: unique device ID, human lane label, active/revoked state, hashed secret credential, current firmware version, last-seen/status, allowed functions and event/session assignment. Secrets are revealed only once at provisioning/rotation; store no plaintext secret.
- `device_scans`: bounded, short-lived pending scan with device, idempotency key, resolved internal member reference, session context, expiry, status and minimal diagnostic metadata. Do not persist card token plaintext in scan logs. Enforce uniqueness and one-time confirmation.
- `audit_log`: append-only admin/security actions: invitation create/revoke/resend, profile visibility override, card issue/revoke/replacement, event/session edits, manual attendance change, point/star adjustment, redemption, role/device management and password-recovery initiation. Include actor, action, target, timestamp, reason and redacted before/after values.
- Consider a separate aggregate/view for leaderboard queries; never grant public clients access to raw ledgers or private attendance rows.

### 5.6 Migrations and seed data

- All schema, indexes, triggers, functions, policies, storage buckets and grants live in ordered SQL migrations.
- `supabase/seed.sql` contains only fictional local-development data and no secrets. Use stable fixtures to test points and visibility rules.
- CI starts a clean local Supabase instance, applies all migrations from zero, seeds fixtures, tests RLS, then tests an upgrade/migration path where practical.
- Provide backup/restore and schema rollback/recovery notes. For irreversible ledger operations, recovery is by compensating entry—not delete/update.

## 6. Authentication, authorization and email

### 6.1 Session/auth implementation

- Follow current official Supabase SSR guidance and PKCE/cookie behavior. Validate session server-side with the supported `getUser()`/equivalent verification method rather than trusting client-provided user metadata.
- Cookies: secure in production, HttpOnly where compatible with the Supabase SSR flow, SameSite protection and scoped path/domain; never store app session tokens in localStorage manually.
- Login, invite acceptance, session refresh, logout and recovery flows must have clear pending/success/error/expired states and be covered by E2E tests.
- Admins must use Supabase Auth MFA (TOTP or the current supported MFA factor) for sensitive administrative routes. If production MFA enrollment cannot be completed without a user/organization action, keep production admin actions gated and ask for the required setup; do not silently weaken this control.
- Suspend/revoke access promptly server-side, with awareness that already-issued JWT claims may not immediately reflect role changes. Authorize sensitive actions from current server-side role data, not stale user-editable claims alone.

### 6.2 Email setup

- Use Supabase Auth invitation/recovery flows with a configured production SMTP/custom email provider and branded templates. The built-in mail sender is rate-limited and is not sufficient for a normal production invitation drive; validate current Supabase limits during setup.
- Local development uses Mailpit or the current Supabase local email capture tool—no real email delivery.
- Emails: invitation/setup, card-ready confirmation, admin-triggered recovery. Keep contents minimal; no passwords, point balance details, card tokens or confidential admin data.
- Use neutral messages for public/recovery paths where needed to avoid exposing whether an email belongs to a member. Rate-limit resend/recovery paths and record a redacted audit event.
- The admin portal must show delivery status/errors where available, avoid duplicate sending on retries, and provide a clear remediation path.

## 7. API contracts

All request/response bodies are schema-validated (Zod); reject unknown or overlarge payloads as appropriate. Return typed, stable error codes and request IDs. Do not return raw database errors.

### 7.1 Public API

- `GET /api/public/leaderboard`: returns only members whose profile is public and whose points and leaderboard flags are enabled. Return ranking, display name/photo/member number where visible, current points and public profile URL. Use deterministic tie-breaking and pagination/caps. Never include email, card data, internal UUID, private stars/points, or hidden members.
- `GET /api/public/events`: list published events with safe public summaries.
- `GET /api/public/events/:slug`: public event detail and visible session descriptions; never expose private attendance records.
- `/c/:cardToken`: validates token hash and active status, then redirects (302/307 as appropriate) to the stable `/m/:profileSlug`. Unknown/revoked/expired tokens receive a neutral response. Apply sensible rate limits and no-store behavior where appropriate.

### 7.2 Member API

- Read/update own profile and visibility settings only.
- Upload/replace photo through an authorized storage flow; validate file size, allowed MIME types and actual image format; re-encode/strip metadata where feasible; generate random object paths; do not trust filename or client-provided content type.
- Read own point/star balances, ledger history, event attendance and redemptions. Do not allow client-submitted member IDs to access someone else's data.
- Generate the authenticated `/c/` QR only when the member has a currently active card; hide the button with an explanation while card is pending/revoked.
- Request redemption via transaction-backed API. Do not accept a client cost/price or client balance.

### 7.3 Admin API

- Invitation CRUD/resend/revoke with duplicate/precondition handling.
- Member search/detail/status; profile edits; audited changes to visible member number/member-since; do not casually change permanent profile slug.
- Prepare/revoke/replace card and enqueue/observe write jobs.
- Create/update/publish/cancel events and sessions; configure windows, durations and rewards; past reward policies remain snapshotted.
- Kiosk: select event/session; query pending scans; confirm/reject check-in/out; award interaction points; correct attendance with reason.
- Reward catalogue and redemption fulfilment.
- Device registration/disable/rotation, lane label/config, writer-mode toggling and heartbeat display.
- Password recovery initiation and audit-log viewing.
- Every endpoint is protected server-side and has a meaningful audit record for state-changing actions.

### 7.4 Device middleware API

Example contract names (final path names can adjust once documented, but preserve the capabilities/boundaries):

- `POST /api/device/v1/heartbeat`
- `POST /api/device/v1/scans`
- `POST /api/device/v1/write-jobs/claim`
- `POST /api/device/v1/write-jobs/:jobId/complete`

Requirements:

- TLS certificate validation is mandatory.
- Authenticate a unique device ID + unique high-entropy secret; server checks enabled device record and secret verifier. Use constant-time comparison where comparing secret bytes. Device keys are rotatable/revocable and have only device-scoped permissions.
- Validate payload size, content type, timestamp/nonce bounds, request IDs and idempotency. Apply per-device rate limiting and reject replayed/duplicate job completion.
- A scan only creates a pending item. It never directly creates a completed attendance record, awards points/stars, or changes a member profile.
- Write jobs are short-lived, one-use, bound to one device and one card operation. Device can claim only its own eligible job, writes the URI, reads it back, and reports a bounded result.
- Use short polling for device jobs and kiosk pending scan UI rather than building a custom long-lived Vercel server process. If realtime is used for browser updates, keep authorization policies explicit and polling as a safe fallback.
- Handle Vercel/serverless constraints: each request must be short and stateless; no in-memory lock or local filesystem is authoritative. All concurrency/idempotency state lives in Postgres.

## 8. UI/UX and design system

### 8.1 Design direction

Implement Material Design through MUI as the single component/design system. Create a central theme with documented color, typography, spacing, border-radius, elevation, focus-ring and breakpoint tokens. Build a small layer of branded primitives in `packages/ui` (`PageShell`, `SectionHeading`, `MetricCard`, `MemberAvatar`, `VisibilityControl`, `EmptyState`, `StatusChip`, `DataTable`, `ConfirmDialog`, `LoadingState`, `ErrorState`). Product pages should compose these primitives rather than styling each page independently.

**Color-scheme behavior (mandatory):** Support both complete light and dark themes; do not make the product dark-mode-only or light-mode-only. The default preference is `System`, which follows the device/browser `prefers-color-scheme` setting and updates when that system setting changes. Provide a visible, accessible manual theme control in the main navigation or account menu with three choices: `System`, `Light`, and `Dark`. Choosing Light or Dark overrides the system preference; choosing System returns to following it. Persist the user's choice locally across reloads, with `System` as the first-visit default. Use MUI's current supported color-scheme APIs and the correct Next.js App Router initialization/SSR pattern to avoid hydration mismatches and avoidable theme flashes; verify this against current official documentation during implementation. Define deliberate semantic tokens for both schemes, including surfaces, borders, text, focus indicators, charts/status colors, and overlays. Meet WCAG 2.2 AA contrast in both modes; never rely on color alone to convey status. Test first visit, system-light, system-dark, changing the OS preference while in System mode, manual override, persistence after reload, keyboard/screen-reader use, and SSR hydration.

Visual direction: confident, modern, editorial-clean, friendly developer-community feel. Use a quiet neutral background, one strong PSU-inspired blue primary, white surfaces, high-contrast text, and restrained event accents. Do not invent or imitate official GDG/PSU logo assets; use supplied/authorized assets if available and otherwise use a clean typographic wordmark. Use a consistent icon family. No decorative stock-photo filler.

Content rule: less text, more useful visual structure. Prioritize a small number of meaningful metrics, member photos, event cards, progress/reward visuals, and a clean leaderboard podium. Keep instructions contextual and short. Avoid giant hero paragraphs, cluttered admin dashboards, walls of cards, fake graphs or placeholder lorem ipsum.

### 8.2 Page experiences

- **Public home:** concise headline, upcoming-event visuals, a small live leaderboard preview, join/member invitation explanation, support link. No public signup form.
- **Leaderboard:** top-three visual treatment and compact sortable/listable ranking; include a clear privacy-respecting empty state when members opt out; never infer missing points as zero or expose hidden members.
- **Public profile:** fast-loading identity-card layout, photo/name, member-since, about/links, chosen points/stars/events, responsive sharing/metadata. Hide all toggled/private fields. QR never appears here.
- **Login/setup:** simple branded forms; readable validation; email/invitation states; explicit password-setting success; friendly expired/revoked link handling.
- **Member dashboard:** glanceable current spendable points and lifetime stars, activity timeline, next/upcoming event when available, merch/rewards, profile completeness/card status and “Show ID”. One primary action at a time.
- **Profile customization:** inline/simple forms, photo crop/preview, validated links, per-field visibility toggles and live public preview. Require name/photo, but allow their public display to be disabled.
- **Admin:** desktop-friendly sidebar that collapses responsively; strong data hierarchy; search-first member management; clear confirmation dialogs for destructive/irreversible actions; table views that become usable cards on narrow screens.
- **Kiosk:** large high-contrast touch targets, large member photo/name, explicit “Confirm check-in”/“Confirm check-out”, visible event/session/lane, clear success/error/offline state, duplicate-scan feedback and no dense administration navigation. Responsive to common tablet/laptop screens.
- **Card writing:** guided one-card-at-a-time stepper showing member, destination URL host (token masked), assigned lane, job expiry, “tap card”, write/read-back success and retry/revoke path. Never show the full card token in logs.
- **Rewards:** visual reward cards, transparent point cost, current balance and clear reserve/fulfillment/cancel state.

### 8.3 Responsive and accessibility standard

- Test at widths 320, 360/375, 768, 1024, 1280 and 1440 px; test touch/keyboard use and zoom. No horizontal overflow or data loss on mobile.
- Aim for WCAG 2.2 AA: contrast, visible focus, semantic heading order, named fields/buttons, keyboard-operable dialogs/menus, screen-reader status announcements, non-color-only feedback and reduced-motion support.
- Use real skeleton/loading/error/empty states. No fake interactivity. Maintain useful alt text and set decorative images appropriately.
- Use optimized images and fixed aspect ratios to prevent layout shift. Avoid loading all photos on leaderboard pages; paginate/limit and optimize.
- Provide metadata and social cards for public profiles without exposing fields users have hidden. Mark sensitive/private account pages `noindex` and apply appropriate cache headers.

## 9. NFC and firmware engineering

### 9.1 Hardware bring-up gate

Before finalizing card library details, physically test the actual PN532 board variants and exact cards. Establish the board interface setting (SPI/I²C/UART), pin mapping, power/logic levels and whether each chosen card is NDEF-readable/writable. Use the board vendor's documentation and the maintained upstream library docs. Do not assume every cheap PN532 breakout has identical wiring or firmware.

The card format must be an NFC Forum-compatible writable NDEF tag that phones read as an HTTPS URL. Select an NTAG21x-compatible card only after confirming the actual purchased batch's behavior, capacity and lock/write state. Firmware must read the URI from NDEF, not infer it from the chip UID.

### 9.2 Firmware state machine

Implement and test a small explicit state machine, for example:

- `BOOTING` → hardware/network/config validation
- `ONLINE_KIOSK` → scan, debounce, post scan, await acknowledgement
- `ONLINE_WRITER` → accept one write job, write, read-back verify, complete job
- `OFFLINE` → show indicator, no attendance/points action; retry with backoff
- `ERROR_RECOVERY` → clear actionable error code, reinitialize PN532/network safely

The selected state is server-controlled where appropriate, but a firmware safety guard must prevent simultaneous writer and kiosk activity. Use watchdog/reboot handling, bounded HTTP operations, checked HTTP status codes and no indefinite waiting loop.

### 9.3 Connectivity and eduroam

The supplied Seneca tutorial is a useful general reference for the idea that eduroam commonly uses 802.1X/WPA2-Enterprise; it is **not** PSU's authoritative device configuration. Before production, verify the current Penn State network rules and supported EAP method/device registration with PSU IT. The campus may change network/authentication requirements, and some device classes have dedicated networks. Do not bypass a captive portal or institutional controls.

- Never hard-code a student's personal Penn State username/password into a committed source file. Never reuse a member's password. Use the sanctioned device/service account or network onboarding mechanism approved by PSU IT.
- Do not disable TLS certificate validation to make HTTPS connect. Use the required CA/server trust chain and test certificate renewal behavior.
- Use official current Espressif Arduino-ESP32/Wi-Fi Enterprise APIs for the pinned core version; older `esp_wifi_sta_wpa2_ent_*` symbols may change. Compile on the exact PlatformIO platform selected.
- If PSU does not authorize ESP32 access to eduroam with the proposed authentication approach, stop and ask the user/PSU IT for an approved option. Do not silently pick a weaker or prohibited network workaround.
- Network success needs a physical test from the actual event environment against the deployed HTTPS API, not merely connecting to a home access point.

## 10. Security and privacy threat model

Treat this as a membership/profile database and a loyalty-value ledger. Minimum threats to mitigate:

1. **Copied static card:** copy does not authorize actions; staff validation is required; active card token can be revoked; rate-limit lookup/scan events; record duplicate attempts.
2. **Forged device request:** unique device key, TLS, device allowlist, scoped endpoints, schema validation, idempotency, request limits, key rotation/revocation, no Supabase credentials on firmware.
3. **Member enumerates profiles/cards:** high-entropy random slug/token, public/private projections, non-revealing error states, throttling and no sequential private lookups.
4. **Member accesses another account:** derive member from verified Auth session server-side; no client-selected member IDs for self-service; tests for IDOR/cross-tenant access on every API.
5. **Member edits own role or balance:** roles/ledger have no member write policy; server-only admin gates; DB transaction functions enforce grants.
6. **Admin account compromise:** MFA for admins, least privilege, audit logs, rate limits and actionable revocation/incident runbook.
7. **Invitation/recovery leakage or replay:** Supabase-managed expiring single-use flows, no tokens in logs, resend/revoke/idempotency rules, neutral responses where appropriate.
8. **Points race/duplicate spending:** immutable ledger, source idempotency, row locks/transactional checks, unique constraints and concurrent tests.
9. **Photo upload abuse:** size/MIME/signature validation, random names, storage RLS, image processing, safe cache policies and metadata handling.
10. **XSS/link abuse:** render text as text, sanitize/validate links, use safe URL schemes, no arbitrary HTML or unsafe redirect parameter. `/c/` only redirects to the known internal profile route.
11. **Audit log leaks secrets:** structured logging with allowlisted fields, redaction, access controls and retention policy.
12. **Supply-chain/config leakage:** lockfile, dependency review, secret scanning, `.env*`/firmware secrets ignored, no keys in build output, no dev service credentials in production.
13. **Information retention:** publish a plain-language privacy note, collect only necessary fields, document photo/account retention and deletion/archive policy, and have admins avoid free-form sensitive notes.

Target OWASP ASVS 5.0.0 as the security verification checklist and document which applicable controls were tested. Do not claim formal certification/audit.

## 11. Testing strategy and mandatory acceptance criteria

“Absolute testing” means extensive layered tests and explicit reporting; it does not mean falsely claiming certainty. No production sign-off until all required gates are either passed or marked blocked with the responsible external action.

### 11.1 Static and unit tests

- `pnpm lint`, formatting check, strict typecheck, production build, package/lockfile consistency.
- Pure domain tests for invitation acceptance, public-profile projection, visibility/leaderboard inclusion, random token format/hash lookup, attendance state transitions, duration threshold boundary, main vs bonus sessions, points/stars equations, reversals, redemption inventory and point balance, device request signing/auth parsing, scan cooldowns and NDEF URI parsing.
- Property-based or exhaustive boundary tests where useful: no negative points; all duplicate retries are idempotent; failed transactions make no partial ledger entries; hidden fields never appear in public projections.
- Firmware host-side unit tests for URL parser/state machine where feasible, plus compile checks for the target ESP32 board and pinned libraries.

### 11.2 Database/integration tests

- Apply migrations from a clean database; test all RLS grants/policies and storage policies using anonymous, member A, member B, admin, disabled device and unknown device contexts.
- Prove member A cannot read/edit member B's private profile, email, ledger, attendance, redemptions or card data.
- Prove anonymous requests cannot read private profiles, emails, raw ledger, device credentials, invites or admin notes.
- Prove a member cannot edit points/stars, assign themselves admin, create attendance, change a card token or fabricate a device scan confirmation.
- Exercise duplicate invite, expired invite, revoked invite, double acceptance, expired card, revoked card, card replacement and old-card revocation.
- Execute simultaneous points redemptions and simultaneous lane check-ins/out; demonstrate no negative balance, duplicate attendance or duplicate reward.
- Verify append-only/compensating-ledger behavior and reason/actor audit completeness.

### 11.3 Playwright end-to-end tests

1. Admin signs in/MFA state is enforced for admin routes.
2. Admin creates paid-member invitation; invitation email is captured in local mail; link works once and expires/revokes correctly.
3. Invitee sets password, enters required name/photo and sees permanent `/m/` link; no profile or `/c/` endpoint existed before acceptance.
4. Member changes about/links/privacy; public page updates only intended fields; email and QR never leak by default.
5. Member logs in and QR is visible only on authenticated `/member/id`; logged-out visitor cannot open it.
6. Admin prepares a card; writer job is claimed by the correct device; simulated/hardware writer reports read-back; card-ready notice is sent.
7. NFC `/c/` URL redirects to stable `/m/`; card replacement revokes old token without changing `/m/`.
8. Admin publishes an event/session with threshold; scan alone creates only a pending scan; admin-confirmed check-in + check-out under threshold grants nothing; at/over threshold grants exact points and stars.
9. Missing checkout grants zero; bonus session requires its own checkout; interaction reward is audited.
10. Members with public points appear on leaderboard; opt-outs and private members do not appear and are not inferable through pagination/counts.
11. Member requests a reward; sufficient balance/inventory succeeds; insufficient balance/retry/concurrency fails safely; cancellation reverses points but not stars unless reversing the original reward itself.
12. Admin correction to attendance requires reason and writes an audit record.
13. Member “forgot password” screen provides exact support mailto instructions; admin recovery sends a functioning email in local/provider-configured environment.
14. Device-disabled/invalid key, invalid URL, expired scan, oversized payload, bad signature/auth, duplicate idempotency key and offline cases fail safely.
15. Mobile/tablet/desktop critical flows pass at target viewport sizes with no lost actions or horizontal overflow.

### 11.4 Accessibility, visual and performance checks

- Run axe-core on all major routes and important dialogs; manually keyboard-test login, invite, profile editor, admin tables, kiosks, modals and QR screen.
- Screenshot review of representative routes at mobile (375px), tablet (768/1024px) and desktop (1440px). Correct layout shift, truncation, poor contrast, awkward empty states and inconsistent spacing—not just snapshot acceptance.
- Set explicit performance budgets and verify a production build: no unnecessary client bundles for static pages, image optimization, paginated leaderboard/history, bounded query counts, no unbounded database select, no expensive query on every route render.
- Run a small load test that simulates two simultaneous lanes, bursts of scans and concurrent redemptions against staging/local services. Record latency, errors and correctness, not just throughput.

### 11.5 Security/operational checks

- Dependency vulnerability audit and lockfile review.
- Secret scanner against the whole Git history, including firmware. Confirm no real secrets in `.env.example`, source, build artifacts, screenshots, test reports or commits.
- Verify security headers (CSP appropriate for Next.js/MUI, HSTS in production, `X-Content-Type-Options`, `Referrer-Policy`, framing protection), safe redirects and origin/CSRF protections for cookie-authenticated mutation endpoints.
- Verify all admin/member routes enforce authorization on the server and public pages have correct caching/noindex behavior.
- Verify logs redact PII and tokens. Test key revocation and device disable takes effect on the next request.
- Complete backup/restore drill on a disposable environment; verify schema + ledger restore and document storage image recovery.

### 11.6 Hardware-in-the-loop acceptance

With actual board/card/network, verify:

- PN532 firmware/version responds reliably and its selected interface/pins are documented.
- A phone opens the exact NDEF HTTPS URL; PN532 reads it; firmware parses the URL correctly.
- Writer writes NDEF, reads back and compares exact hostname/path/token; incompatible/locked/full tag yields a clear failure.
- Two separate devices on two lanes report distinct IDs and authenticate independently; disabling one blocks its API use without affecting the other.
- Duplicate taps, repeated HTTP submissions, server timeout/retry, clock skew, reboot, Wi-Fi drop/reconnect and API outage do not award points automatically or duplicate actions.
- Writer mode pauses attendance scan handling on that unit and is visibly indicated.
- Actual Penn State-approved network and deployed TLS endpoint work without disabling certificate checks.

If physical hardware, campus network authorization, email delivery credentials or Vercel/Supabase project access are unavailable to the agent, finish every software/mock/compile test that can legitimately run, clearly mark those exact hardware/external gates **BLOCKED**, and ask the user for the required access/action. Never label a simulation as a hardware pass.

## 12. Deployment, operations and recovery

### 12.1 Environments

- **Local:** `pnpm dev` plus local Supabase CLI/Docker and captured email; fake members only. Include `.env.example`, seed fixtures and a one-command setup checklist.
- **Preview/staging:** separate Supabase project and Vercel preview env; never use production member records in preview. Use staging-only test members and device keys.
- **Production:** user-owned Vercel project + Supabase project, custom domain/DNS for `member.gdgpsu.dev`, production SMTP, required admin MFA, storage policies, rate limits, backups and approved device network config.

Required environment variable names should be centralized and documented. Suggested classes include public Supabase URL/anon key, server-only Supabase secret/service key, site URL, auth callback allowlist, SMTP settings or provider configuration, short-lived write-payload encryption key, and environment-specific logging settings. Never put secrets under a `NEXT_PUBLIC_` prefix. Provide validators at startup and fail closed for missing production secrets.

### 12.2 Vercel

- Configure the monorepo root/build command using current Vercel + Turborepo docs; make the web app the deploy target and ensure workspace packages are included in tracing/builds.
- Configure environment variables separately for Development/Preview/Production; do not commit actual `.env` files.
- Add custom domain only with authorized DNS access. Test callback URLs, redirects, canonical metadata and cookie behavior on the final HTTPS domain.
- Keep device/API requests short; no persistent process, local disk state or in-memory lock is assumed.
- Set caching deliberately: immutable static assets cacheable; profile/leaderboard behavior must reflect privacy and fresh balances without accidentally serving private data to other users. Use server-side no-store/private caching for authenticated pages and token-bearing routes as appropriate.

### 12.3 Supabase

- Production migration is reviewed and applied intentionally; do not let application startup auto-run schema changes against production.
- Configure Auth redirect allowlist to exact known domains and route paths.
- Configure branded invitation/recovery templates and delivery service; validate sender/domain authentication (SPF/DKIM/DMARC as needed by provider).
- Configure Storage buckets/policies for profile images; enforce size/type limits.
- Enable database backups/PITR according to the chosen project plan; document limits, retention and how to restore. Test one restore.
- Set RLS/policies on all relevant tables and review generated API exposure.

### 12.4 Day-of-event runbook

Provide a human-readable runbook for admins with preflight: confirm event/session and thresholds, test both devices, check firmware/API versions and heartbeats, test write mode only on a non-production test card, confirm server time/network, log in with MFA, verify photos/name confirmation, and identify support contact. Include how to switch one lane into writer mode, revoke a lost card, handle duplicate/unknown cards, mark device offline, correct a missed checkout with reason and close the event. The routine must not require database console access.

### 12.5 Monitoring and recovery

- Structured request IDs across browser/API/device. Dashboard for device last seen/firmware, failed jobs, scan queue age, pending attendance, delivery failures and ledger anomalies.
- Define sensible alerts/thresholds, while avoiding alerts that contain member PII.
- Include incident steps for leaked device key, compromised admin, exposed card-token list, bad ledger grant, failed migration, deleted photo and Vercel/Supabase outage.
- Key rotation/revocation and restoration steps must be tested, not just documented.

## 13. Build sequence

Implement vertically, preserving a green test suite after each phase.

1. **Repository reconnaissance and constraints:** inspect files, current git status/config, available runtimes, Node/pnpm/Docker/PlatformIO/toolchain, hardware/USB access. Preserve existing work. Identify true user-only prerequisites early.
2. **Monorepo foundation:** pinned runtime/package manager, workspace/Turbo scripts, strict TypeScript, lint/format, CI workflow, environment validation, README, documented stable stack, Git discipline.
3. **Supabase foundation:** initial migrations, schema/types, RLS, storage policies, local seed, pgTAP tests, transactional ledger primitives and audit functions.
4. **Auth and invite:** login, SSR sessions, invitation creation/acceptance, password setup, required profile fields, support-based reset experience, email capture/provider integration.
5. **Public/member experience:** landing, stable profiles, profile editor/privacy controls, member dashboard, ID/QR, public leaderboard/events and safe public API.
6. **Points/event domain:** event/session configuration, scan state, check-in/out state machine, duration eligibility, points/stars ledger, adjustments and history.
7. **Admin workflows:** member/invite management, card state management, event/session editor, kiosk validation queue, interactions/rewards/redemptions, password recovery, device config, audit log.
8. **Firmware/device API:** one device happy path first, NDEF read/write and HTTPS validation, job/scan idempotency, offline/error states, then parallel second lane and concurrent-event tests.
9. **Polish/accessibility/security:** unify UI tokens and components, empty/error/loading states, responsive work, WCAG checks, security headers/rate limiting, dependency and secret scans.
10. **End-to-end/release gates:** all local tests, migration clean-start test, E2E/security/load checks, production build, hardware checklist, deployment docs, recovery drill where access exists.
11. **Repo handoff:** README setup instructions, known blockers, exact commands/results, architecture/security/operations docs and commits with no AI attribution trailers.

## 14. Definition of done

The application is not considered done merely because `next build` succeeds. Done means:

- A clean checkout can install from the lockfile and run documented local development without proprietary secrets.
- A fresh local database builds entirely from migrations and all policy/domain tests pass.
- Invite-to-first-login, member profile/privacy, `/c/` redirect/revocation, event check-in/out and points/stars, rewards/redemption and admin audits work end to end.
- All public/private data rules and role boundaries have explicit negative tests.
- UI has been visually reviewed at mobile, tablet and desktop, and accessibility tests/keyboard checks are documented.
- Two-lane concurrency and the actual card writer/reader path are tested at the level available; hardware/network gaps are plainly marked blocked, never simulated as passed.
- CI is configured; lint, formatting, typecheck, unit, database integration and Playwright suites are passing or have a specifically documented external blocker.
- No secrets or AI-attribution commit trailers are in the repository/history created for this project.
- Deployment, key rotation, card replacement, event-day operation, backup/restore and incident runbooks exist.
- All required human-only actions are collected in a short `BLOCKERS`/handoff section with an exact question/action and no inferior silent substitute.

## 15. External prerequisites the agent must not fake

The agent should build everything it can locally, and pause to ask the user only for the exact action/access it cannot obtain itself. Do not halt unrelated software work just because production credentials are absent.

1. **Penn State networking:** approved access method and any required device/service identity or network registration for ESP32s. The Seneca tutorial does not establish PSU policy.
2. **Physical hardware:** exact PN532 breakout variants, selected writable NFC cards, USB/debug access and an actual event environment for full end-to-end testing.
3. **Production services:** Supabase project ownership/credentials, Vercel account/project, DNS access for `member.gdgpsu.dev`, production email sender/SMTP configuration, and a user-approved admin bootstrap identity.
4. **Main-site integration:** if an existing `gdgpsu.dev` website must embed the leaderboard, the agent needs that source repo or an approved integration point. Without it, fully implement `/leaderboard` and a documented `/api/public/leaderboard` contract and ask for the main-site repo/access before claiming integration.
5. **Brand/legal assets:** official logo or an explicit license choice is needed if the agent is expected to include/redistribute those assets. Use a clean typographic GDG@PSU treatment until authorized assets are supplied; do not fabricate a logo or pick a legal license without user approval.

## 16. Reference documentation

Use these as verification entry points; confirm current guidance and exact package/version details during implementation.

- Next.js documentation: https://nextjs.org/docs
- Supabase SSR: https://supabase.com/docs/guides/auth/server-side
- Supabase Auth users/invites: https://supabase.com/docs/guides/auth/users
- Supabase rate limits: https://supabase.com/docs/guides/auth/rate-limits
- Supabase PostgreSQL Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control
- Supabase local development: https://supabase.com/docs/guides/local-development
- Vercel/Turborepo monorepos: https://vercel.com/docs/monorepos/turborepo
- Vercel function limits: https://vercel.com/docs/functions/limitations
- MUI / Material Design components: https://mui.com/material-ui/
- Espressif Arduino-ESP32 Wi-Fi station API: https://github.com/espressif/arduino-esp32/blob/master/libraries/WiFi/src/STA.cpp
- Adafruit PN532 library API: https://github.com/adafruit/Adafruit-PN532
- Penn State wireless information: https://www.it.psu.edu/wireless/
- User-supplied general eduroam reference (not PSU authority): https://senecaengineering.org/tutorials/connecting-esp32-to-eduroam/
- OWASP Application Security Verification Standard: https://asvs.owasp.org/
- GitHub commit signing behavior: https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits
