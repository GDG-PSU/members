# API and server actions

This repository has three kinds of server surface:

1. Route handlers under `apps/web/src/app/api/` and `/c/[cardToken]`.
2. Next.js Server Actions used by the app's own forms.
3. Server-side data access in Server Components (not an HTTP API).

## Implementation status

| Surface | Status |
| --- | --- |
| `POST /api/auth/session`, `POST /api/auth/signout` | Implemented |
| `GET /c/<card-token>` | Implemented |
| Member/auth Server Actions | Implemented |
| `GET /api/public/leaderboard`, `/api/public/events`, `/api/public/events/:slug` | Implemented |
| Admin portal + Server Actions | Implemented under `app/(admin)/admin/*`; admin MFA gate at `/admin-mfa` |
| `GET /api/admin/kiosk/pending`, `POST /api/admin/kiosk/confirm` | Implemented (cookie session + server-side admin check) |
| `/api/device/v1/*` | Implemented; device auth, rate limits and idempotency enforced |

All authenticated surfaces derive the actor from the verified Supabase session and re-check the role in the database; no client-supplied role or member id is trusted.

## Authentication model

- Browser sessions are Supabase SSR cookies (HttpOnly), created by `POST /api/auth/session` or the login Server Action.
- Server components/actions call `supabase.auth.getUser()`; the member is derived from the verified user, never from a client-supplied ID.
- Admin access is checked from `user_roles` server-side.
- The Supabase secret key is used server-side only; it never appears in browser bundles.

## Existing route handlers

### `POST /api/auth/session`

Completes an email-link sign-in by accepting the tokens from the URL fragment.

Request:

```json
{ "accessToken": "<jwt>", "refreshToken": "<token>", "next": "/invite/accept" }
```

- `accessToken` min 20 chars; `refreshToken` min 10; `next` must start with `/` and is rejected/replaced if it starts with `//`.
- Content type must be JSON (parsed manually).
- Calls `supabase.auth.setSession`, then copies the resulting cookies onto the response.

Responses:

| Status | Body |
| --- | --- |
| 200 | `{ "redirectTo": "/invite/accept" }` and `Cache-Control: no-store` |
| 400 | `{ "error": "Invalid session payload." }` |
| 401 | `{ "error": "That sign-in link is invalid or expired." }` |

This endpoint intentionally accepts tokens because Supabase's email verification redirect delivers them in the fragment. It does not log token values.

### `POST /api/auth/signout`

No body. Clears the Supabase session and responds `303` to `/login?notice=signed-out`. A cross-site POST can sign a user out; impact is limited to a forced logout.

### `GET /c/[cardToken]`

Resolves an NFC card URL.

- Token must match `^[A-Za-z0-9_-]{43}$`; otherwise redirects to `/card-unavailable`.
- Applies `consume_rate_limit(bucket = card-lookup:<first 16 hex of SHA-256(token)>, limit = 30, window = 60s)`.
- Hashes the token (SHA-256), looks up `card_credentials` with `status = 'active'`, and redirects `307` to `/m/<profile-slug>` with `Cache-Control: no-store`.
- Unknown, revoked, replaced, lost or rate-limited tokens redirect to `/card-unavailable` with no member metadata.
- No member data, token value or internal identifier is returned in the response body.

Limitation: the limiter bucket is per token, not per client IP. Cycling many valid-format tokens is not globally limited at this layer.

## Public JSON endpoints

- `GET /api/public/leaderboard?limit=&offset=` returns `{ entries, pagination, generatedAt, requestId }`. Entries contain only `rank`, `slug`, `displayName`, `photoUrl`, `memberNumber`, `points` and include only public, opted-in members.
- `GET /api/public/events` returns published public events.
- `GET /api/public/events/<slug>` returns the event and its enabled sessions, or 404.
- All set `Cache-Control: no-store`.

## Admin endpoints

- `GET /api/admin/kiosk/pending` — poll the pending scan queue; returns member name/photo, event/session and suggested action. Requires an admin cookie session.
- `POST /api/admin/kiosk/confirm` — body `{ scanId, action: 'check_in'|'check_out'|'reject', reason? }`; calls `confirm_scan` atomically, applies a per-admin rate limit (60/min), and returns `{ ok, attendanceId }`. A scan is never awarded automatically.

All other admin mutations are Server Actions (below). They require `getViewer().isAdmin` on the server and write an `audit_log` row; most finish with `redirect()` to the originating page with a notice/error query parameter.

### Admin Server Actions

| Area | Actions |
| --- | --- |
| Invitations | `createInvitationAction`, `invitationAction` (resend/revoke) — duplicate pending emails blocked; provider errors surfaced; Auth user rolled back if the invitation row fails. |
| Members | `setMemberStatusAction`, `adjustMemberPointsAction`, `sendRecoveryAction` — reasoned and audited; recovery never returns a token. |
| Cards | `prepareCardAction` (new token + revoke previous + encrypted one-time write job), `revokeCardAction`, `completeWriteJobAction` (cancel). |
| Events | `saveEventAction` (event + exactly one main session + optional bonus), `setEventStatusAction`. |
| Kiosk | `confirmScanAction`, `correctAttendanceAction` — required reasons, audited state transitions. |
| Rewards | `saveRewardAction`, `decideRedemptionAction` (approve/fulfil/reject/cancel with refund). |
| Devices | `createDeviceAction` (secret returned once), `updateDeviceAction` (lane/mode/enable/rotate secret). |
| MFA | `/admin-mfa` actions `enrollMfaAction`, `verifyMfaAction` (Supabase TOTP, AAL2 required for `/admin/*`). |

## Server Actions

Server Actions are POST requests generated by Next for same-origin forms; they are not a documented public API. They return serializable state objects (`{ ok?, message?, error? }`) except where they finish with `redirect()`. All inputs are parsed with Zod; all require an authenticated session unless noted.

| Action | File | Auth | Behavior |
| --- | --- | --- | --- |
| `signInAction(prev, formData)` | `app/(auth)/login/actions.ts` | none | Email/password login via Supabase. Normalizes email. Rejects inactive memberships and signs out. Redirects member → `/member`, admin-only → `/admin`, otherwise `/invite/accept`. Returns a generic error for bad credentials. |
| `completeSetupAction(prev, formData)` | `app/(auth)/invite/accept/actions.ts` | signed-in, no member | Requires name, password ≥12 with letter+digit, matching confirmation, consent, and a photo. Re-encodes the photo, sets the password, generates slug + public number, calls `complete_member_setup`, audits, redirects to `/member?welcome=1`. Retries on unique collisions; never creates a member without a profile. |
| `updateProfileAction(prev, formData)` | `app/(member)/member/actions.ts` | active member | Validates display name (2–60), about (≤280), ≤6 `https://` links; optionally replaces the photo (2 MB, JPEG/PNG/WebP, re-encoded, old object deleted); audits before/after; revalidates member + public profile. |
| `updatePrivacyAction(prev, formData)` | same | active member | Reads all 12 visibility booleans, updates the profile, audits before/after, revalidates member/public/leaderboard. |
| `requestRedemptionAction(prev, formData)` | same | active member | Validates reward id, quantity 1–5, idempotency key (8–64). Calls `redeem_reward` (server-computed cost/balance). Maps `insufficient_points`, `out_of_stock`, `reward_unavailable` to messages. Audits. |
| `cancelRedemptionAction(formData)` | same | active member | Verifies the redemption belongs to the caller and is `requested`/`approved`; calls `decide_redemption(action = cancel, reason = "Cancelled by member")`; audits; revalidates. |

## Errors and validation

- Route handlers use `lib/api.ts`: `jsonOk` sets `Cache-Control: no-store`; `ApiError` maps to a stable `{ error: { code, message, requestId, details? } }` shape; unknown database errors are mapped for known domain codes and otherwise return a generic 500 with a request ID. Raw database errors are not returned.
- The two auth route handlers use the simpler `{ error: string }` shape described above.
- Server Actions return `{ error }` or `{ ok, message }` for display; they do not expose stack traces.
- Zod rejects unknown/oversized input at action boundaries. Photo files are limited to 2 MB and validated by decoding, not by filename.

## Idempotency and rate limiting

| Operation | Mechanism |
| --- | --- |
| Point/star grant | `point_ledger.source_key` unique; `grant_points` returns the existing id on retry |
| Attendance reward | `source_key = attendance:<attendance id>`; one attendance per member/session |
| Redemption request | unique `(member_id, idempotency_key)`; repeated key returns the same redemption |
| Card write | single-use job + nonce; completion rejects non-open jobs; read-back required for success |
| Token lookup | fixed-window limiter in Postgres (`consume_rate_limit`) |
| Invite acceptance | `complete_member_setup` returns the existing member for the Auth user |

## Device API (implemented)

Headers: `x-device-id`, `x-device-secret`, `x-request-id`; JSON bodies; HTTPS with certificate validation. Authentication hashes the presented secret and compares in constant time against the stored verifier; disabled/revoked devices are rejected; each device has a 120/min auth and 40/min scan budget.

| Method/path | Behavior |
| --- | --- |
| `POST /api/device/v1/heartbeat` | Validates credentials, records last-seen/firmware, returns server-assigned mode and session. |
| `POST /api/device/v1/scans` | Validates a 43-char token, resolves the active card server-side, ensures the session window is open, and inserts a pending scan (unique per device/idempotency key). Never awards attendance or points. |
| `POST /api/device/v1/write-jobs/claim` | Writer mode only; claims one queued job for this device, decrypts the short-lived card URL, marks it claimed. |
| `POST /api/device/v1/write-jobs/complete` | Reports `written`/`failed`; `written` requires read-back match; activates the card and destroys the job payload. |

Scan responses: `{ scanId, status, action, expiresAt }`; claim returns `{ job: null }` or `{ job: { id, cardUrl, expiresAt } }`. Tokens are never logged. The firmware client targets these exact paths.

| Method/path | Purpose |
| --- | --- |
| `POST /api/device/v1/heartbeat` | Authenticate device, report firmware/mode/diagnostics, receive server-assigned mode |
| `POST /api/device/v1/scans` | Submit one parsed card token + idempotency key; creates a pending scan only |
| `POST /api/device/v1/write-jobs/claim` | Claim one queued write job bound to this device |
| `POST /api/device/v1/write-jobs/:jobId/complete` | Report written/failed with read-back result |

Headers: `x-device-id`, `x-device-secret`, `x-request-id`. TLS certificate validation is mandatory. These endpoints must validate device status, payload size/content type, idempotency and rate limits before touching data. They are not implemented in this checkout, so the firmware cannot complete a live flow yet.
