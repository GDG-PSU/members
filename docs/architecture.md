# Architecture

## System shape

```text
Member / Admin browser
  └── HTTPS → Next.js App Router (Vercel)
                ├── Supabase Auth (email + password, invitation/recovery links)
                ├── Postgres via Supabase (RLS + transactional SQL functions)
                ├── Supabase Storage (`avatars` bucket, server-side uploads)
                └── Admin copies one-time auth links (no SMTP; email is manual)

ESP32 + PN532 lane A ─┐
ESP32 + PN532 lane B ─┼── HTTPS, device ID + per-device secret → /api/device/v1/*
                      │      (narrow middleware API; never Supabase keys)
                      └── server creates pending scans / one-use write jobs
Admin kiosk browser ── authenticated admin → confirms or rejects pending scans
```

The repository is a pnpm workspace with Turborepo:

- `apps/web` — the only deployable web app (Next.js, strict TypeScript, MUI).
- `packages/ui` — central MUI theme/tokens and branded primitives.
- `packages/contracts` — framework-neutral Zod schemas and public types.
- `supabase/migrations` — schema, policies, functions, storage configuration.
- `scripts` — migration runner and transactional database verification.
- `firmware/kiosk-reader` — PlatformIO ESP32/PN532 project.

## Trust boundaries

1. **Browser → Next server.** The browser holds only an HttpOnly Supabase session cookie. Every member/admin page, server action and route handler re-checks the session and the server-side role/member record. Client-side visibility is never authorization.
2. **Next server → Supabase.** The server holds the Supabase secret (service) key. Signed-in requests use the user's access token, so Postgres RLS applies to member reads. Privileged writes are executed by the server only after an explicit authorization check and then call narrowly-scoped SQL functions.
3. **Device → Next server.** Devices have their own identity (public device ID + high-entropy secret), separate from user identity. They can heartbeat, submit a card token, claim their own write job, and report completion. They cannot award points, choose members/events, or reach Supabase.
4. **Admin → attendance/points.** A tap creates only a `pending` scan. A human admin must confirm check-in, then check-out, before points exist. A card link (`/c/...`) is a routing identifier, never an authentication factor.
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
device scan → POST /api/device/v1/scans
  → device auth + schema validation + idempotency
  → resolve card hash to an active card
  → insert device_scans(status = pending, expires_at = now + 3 min)
  → kiosk polls pending scans
  → admin confirms check-in   (confirm_scan inserts attendance, state = checked_in)
  → admin confirms check-out  (confirm_scan computes duration in the transaction)
       ├─ below threshold or no checkout → no ledger row, qualified = false
       └─ at/over threshold → grant_points(source_key = attendance:<id>)
                               → point_ledger + mirrored star_ledger
  → audit_log + attendance_audit_events
```

`confirm_scan` locks the scan, validates expiry/window/session state, and performs all changes in one transaction. Duplicate check-in, duplicate check-out, missing check-in, expired scan and out-of-window attempts raise stable error codes that the UI maps to human messages.

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
- long-lived jobs or background daemons (write jobs are short polling, scans expire);
- local filesystem state (uploads go to Supabase Storage);
- long request chains (device requests are bounded and return typed errors quickly).

Kiosk and device updates use short polling rather than realtime channels; polling is simpler to authorize, works through campus networks, and needs no durable-object process. Realtime may be added later without changing the authoritative database transitions.

## Failure behavior

- Device API/network failure → firmware shows offline/error, never awards attendance locally, never replays untrusted offline scans. Recovery is an explicitly audited admin correction.
- Duplicate taps → device idempotency key + pending-scan uniqueness + `confirm_scan` locks.
- Request retries → idempotent SQL functions keyed by source/idempotency keys.
- Photo upload failure → setup/profile update returns an actionable error; no partial profile is created without a photo.
- Supabase outage → pages fail closed; no fallback to client-trusted state.

## What is deliberately not in the browser

The Supabase secret key, card tokens, device secrets, invitation/recovery URLs, member emails (unless opted in), internal member UUIDs, card token hashes and audit internals are all server-only. The browser receives only the projected fields needed to render the page.
