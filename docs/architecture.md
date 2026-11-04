# Architecture

> **Current hardware path (2026-11-04):** The reader is a USB-only ESP32 +
> PN532 controlled by an admin browser over Web Serial at `/admin/usb` and
> `/admin/kiosk`. It has no WiFi, server device client, registration, HMAC
> secret, heartbeat, or kiosk polling. The signed device API, kiosk queue, and
> writer-job sections below are legacy history; do not use them for the current
> hardware. The old Devices tab is removed; `/admin/devices` redirects to
> `/admin/usb`.

## System shape

```text
Member / Admin browser
  └── HTTPS → Next.js App Router (Vercel)
                ├── Supabase Auth (email + password, invitation/recovery links)
                ├── Postgres via Supabase (RLS + transactional SQL functions)
                ├── Supabase Storage (`avatars` bucket, server-side uploads)
                └── Admin copies one-time auth links (no SMTP; email is manual)

Admin browser (AAL2) ── USB serial ── ESP32 + PN532 (no WiFi, no server client)
  ├── /admin/usb   → prepare / write / read back / activate cards
  ├── /admin/kiosk → select session → read card → confirm check-in/check-out
  └── Server Actions / API → Next.js → Supabase
```

The former WiFi path (`/api/device/v1/*`, pending-scan polling, writer jobs) is
retained only for historical records and is not part of the current hardware
flow.

The repository is a pnpm workspace with Turborepo:

- `apps/web` — the only deployable web app (Next.js, strict TypeScript, Tailwind CSS v4 + shadcn/ui-style components).
- `packages/ui` — central Tailwind token layer, shadcn-style primitives and branded components.
- `packages/contracts` — framework-neutral Zod schemas and public types.
- `supabase/migrations` — schema, policies, functions, storage configuration.
- `scripts` — migration runner and transactional database verification.
- `firmware/kiosk-reader` — PlatformIO ESP32/PN532 project.

## Trust boundaries

1. **Browser → Next server.** The browser holds only an HttpOnly Supabase session cookie. Every member/admin page, server action and route handler re-checks the session and the server-side role/member record. Client-side visibility is never authorization.
2. **Next server → Supabase.** The server holds the Supabase secret (service) key. Signed-in requests use the user's access token, so Postgres RLS applies to member reads. Privileged writes are executed by the server only after an explicit authorization check and then call narrowly-scoped SQL functions.
3. **USB lane → admin browser → Next server (current).** The reader exposes only local newline-delimited JSON over Web Serial; it never reaches the network. The admin page still requires a verified AAL2 admin session, and every preview/confirmation is re-authorized server-side. The former signed device API is legacy and unused.
4. **Admin → attendance/points.** A card read creates only a preview and a short-lived pending scan. A human admin must confirm check-in, then check-out, before points exist. A card link (`/c/...`) is a routing identifier, never an authentication factor.
5. **Public → data.** Public pages read explicit projections (`public_profiles`, `leaderboard`) with column-level visibility. No public query serializes a table row or Auth user.

## Current authentication implementation

- `apps/web/src/lib/supabase/server.ts` creates a cookie-bound client with the **publishable** key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`), so every query is subject to RLS. The secret key is used only by the admin client.
- After `signInWithPassword` / invite callback, requests carry the user's access token. PostgREST then evaluates RLS as that user, so member isolation is exercised by the database, not just app code.
- Unauthenticated/public reads use `apps/web/src/lib/supabase/admin.ts` against the explicit public views. RLS is bypassed for those reads, so these queries must never select from base tables or serialize arbitrary rows.
- Invitations use Supabase's Admin API. The member lands on `/auth/callback`, where a small client component forwards the URL-fragment tokens to `POST /api/auth/session`; the server sets the session cookies and redirects. This avoids requiring a browser Supabase key.
- Invitations and recovery are admin-initiated and **manual**: the admin API generates a one-time link, the portal returns it to a client form, and the admin copies it into their own mail client. No email provider is involved. Members without a link are directed to email `gdg@psu.edu`.
- The secret key remains server-only and is limited to `createSupabaseAdmin()` call sites (auth-admin link generation, cross-member reads, device jobs, public-projection reads). Those call sites must authorize the actor first and must never serialize arbitrary rows.

## Request flows

### Member sign-in and setup

1. Admin records dues and generates an invitation link (server-only, idempotent per pending email). The admin copies it to the member manually.
2. The link verifies with Supabase Auth and redirects to `/auth/callback#access_token=…&refresh_token=…`.
3. `/api/auth/session` sets HttpOnly session cookies. The member lands on `/invite/accept`.
4. The member sets a password (`auth.updateUser`), uploads a photo (server validates/re-encodes with `sharp`), and submits name/bio/consent.
5. `complete_member_setup(...)` atomically creates `members`, `member_private`, `member_profiles`, generates the permanent slug and member number, and marks the invitation accepted. It is safe against retries.
6. The server queues audit entries. No card is created until an organizer prepares one.

### Public profile and card routing

- `/m/<slug>` reads `public_profiles`; hidden fields are absent from the row. A private or unknown profile renders the neutral not-found state.
- `/c/<token>` validates the 43-character token format, applies a rate limit, hashes the token with SHA-256, looks up an `active` card, and redirects (307, `no-store`) to the member's stable `/m/<slug>`. Revoked/replaced cards go to `/card-unavailable` with no member metadata.

### Attendance and points

```text
USB card read (Web Serial nfc.read)
  → admin selects event session on /admin/kiosk
  → previewUsbKioskAction validates card, member, session/window and photo state
  → insert device_scans(status = pending, device_id = null, expires_at = now + 3 min)
  → admin verifies photo/PSU ID and confirms check-in
       → POST /api/admin/kiosk/confirm → confirm_scan
  → admin reads the same card again and confirms check-out
       ├─ below threshold or no checkout → no ledger row, qualified = false
       └─ at/over threshold → grant_points(source_key = attendance:<id>)
                               → point_ledger + mirrored star_ledger
  → audit_log + attendance_audit_events
```

`confirm_scan` locks the scan, validates expiry/window/session state, and performs all changes in one transaction. Duplicate check-in, duplicate check-out, missing check-in, expired scan and out-of-window attempts raise stable error codes that the UI maps to human messages. The legacy WiFi flow (`POST /api/device/v1/scans` plus polling) is described below only for historical context and is not executed by the USB kiosk.

### Spending points

`redeem_reward` locks the member row and reward row, checks the ledger-derived balance and inventory inside the transaction, writes a negative `redemption` entry and decrements stock. Concurrent requests serialize on the locks; the second either fails with `insufficient_points`/`out_of_stock` or returns the same redemption for a repeated idempotency key. Cancellation/rejection adds a `redemption_refund` entry and restocks.

## Why ledger-derived balances

Points are loyalty value and attendance is an attendance record. Editing or deleting rows would destroy the audit trail and make disputes unanswerable. Therefore:

- ledger tables are append-only at the database level (triggers, not convention);
- balances are always sums, never directly assigned;
- corrections are compensating entries with actor and reason;
- grant source keys make retries idempotent;
- reward rules and costs are snapshotted onto the transaction that used them;
- aggregate read models (`member_balances`, `public_profiles`, `leaderboard`) are views, so they cannot drift.

Audit rows outlive the accounts they name. `audit_log.actor_auth_id` is a UUID without a foreign key (migration 0005): the append-only trigger blocks the `ON DELETE SET NULL` update an FK would perform, so retaining the historical actor id both preserves the trail and lets account deletion complete.

## Serverless constraints

Vercel functions are short-lived and stateless, so the design avoids:

- in-memory locks or rate limits (locks and limiter state live in Postgres);
- long-lived jobs or background daemons (USB commands are request/response and scans expire);
- local filesystem state (uploads go to Supabase Storage);
- long request chains (device requests are bounded and return typed errors quickly).

The USB kiosk is a local, operator-driven request/response flow; it does not poll a device queue. Realtime may be added later without changing the authoritative database transitions.

## Failure behavior

- USB lane failure → the page shows the serial/protocol error; no attendance is written locally. Recovery is a retry or an explicitly audited admin correction.
- Duplicate taps → device idempotency key + pending-scan uniqueness + `confirm_scan` locks.
- Request retries → idempotent SQL functions keyed by source/idempotency keys.
- Photo upload failure → setup/profile update returns an actionable error; no partial profile is created without a photo.
- Supabase outage → pages fail closed; no fallback to client-trusted state.

## What is deliberately not in the browser

The Supabase secret key, card tokens, device secrets, invitation/recovery URLs, member emails (unless opted in), internal member UUIDs, card token hashes and audit internals are all server-only. The browser receives only the projected fields needed to render the page.
