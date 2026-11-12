# API and server actions

> **Current hardware note (2026-11-04):** `/api/device/v1/*` and
> `GET /api/admin/kiosk/pending` are legacy and are not called by the USB
> firmware or the current kiosk UI. `POST /api/admin/kiosk/confirm` is still the
> confirmation transaction used by `/admin/kiosk`; the preview is the
> `previewUsbKioskAction` Server Action. Card operations are Server Actions used
> by `/admin/cards`: prepare a pending card, display its one-time `/c/<token>` URL,
> then activate it after the admin attests to a matching USB read-back.

This repository has three kinds of server surface:

1. Route handlers under `apps/web/src/app/api/` and `/c/[cardToken]`.
2. Next.js Server Actions used by the app's own forms.
3. Server-side data access in Server Components (not an HTTP API).

## Implementation status

| Surface                                                                         | Status                                                                  |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `POST /api/auth/session`, `POST /api/auth/signout`                              | Implemented                                                             |
| `GET /c/<card-token>`                                                           | Implemented                                                             |
| Member/auth Server Actions                                                      | Implemented                                                             |
| `GET /api/public/leaderboard`, `/api/public/events`, `/api/public/events/:slug` | Implemented                                                             |
| Admin portal + Server Actions                                                   | Implemented under `app/(admin)/admin/*`; admin MFA gate at `/admin-mfa` |
| `GET /api/admin/kiosk/pending`, `POST /api/admin/kiosk/confirm`                 | Pending endpoint legacy; confirmation used by the USB kiosk             |
| `/api/device/v1/*`                                                              | Implemented; device auth, rate limits and idempotency enforced          |

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

| Status | Body                                                               |
| ------ | ------------------------------------------------------------------ |
| 200    | `{ "redirectTo": "/invite/accept" }` and `Cache-Control: no-store` |
| 400    | `{ "error": "Invalid session payload." }`                          |
| 401    | `{ "error": "That sign-in link is invalid or expired." }`          |

This endpoint intentionally accepts tokens because Supabase's email verification redirect delivers them in the fragment. It does not log token values.

### `POST /api/auth/signout`

No body. Clears the Supabase session and responds `303` to `/login?notice=signed-out`. A cross-site POST can sign a user out; impact is limited to a forced logout.

### `GET /c/[cardToken]`

Resolves an NFC card URL.

- Token must match `^[A-Za-z0-9_-]{43}$`; otherwise redirects to `/card-unavailable`.
- Applies `consume_rate_limit(bucket = card-lookup:<hash of the client address>, limit = 120, window = 60s)`.
- Hashes the token (SHA-256), looks up `card_credentials` with `status = 'active'`, and redirects `307` to `/m/<profile-slug>` with `Cache-Control: no-store`.
- Unknown, revoked, replaced, lost or rate-limited tokens redirect to `/card-unavailable` with no member metadata.
- No member data, token value or internal identifier is returned in the response body.

The bucket is per client rather than per token: 256-bit tokens cannot be guessed, and a per-token bucket would let anyone add a database row for each random URL.

## Public JSON endpoints

- `GET /api/public/leaderboard?limit=&offset=` returns `{ entries, pagination, generatedAt, requestId }`. Entries contain only `rank`, `slug`, `displayName`, `photoUrl`, `memberNumber`, `stars` and include only public, opted-in members who share their stars.
- `GET /api/public/events` returns published public events.
- `GET /api/public/events/<slug>` returns the event and its enabled sessions, or 404.
- All set `Cache-Control: no-store`.

## Admin endpoints

- `GET /api/admin/kiosk/pending` — legacy pending-scan polling endpoint. It is retained for historical data and diagnostics; the USB kiosk does not use it.
- `POST /api/admin/kiosk/confirm` — body `{ scanId, action: 'check_in'|'check_out'|'reject', reason?, identityCheck? }`; calls `confirm_scan` atomically, applies a per-admin rate limit (60/min), and returns `{ ok, attendanceId }`. If the member's photo changed within 48 hours, a check-in or check-out without `identityCheck: true` is rejected with 400; a successful check writes an `attendance.identity_checked` audit row. A scan is never awarded automatically. This is the current USB kiosk confirmation endpoint.

### USB kiosk preview

`/admin/kiosk` calls the `previewUsbKioskAction` Server Action after Web Serial returns one card URI. The action validates the URL/token, active card and member, session and check-in/check-out window, and photo-change state. It creates a short-lived pending `device_scans` row with `device_id = null` and `metadata.source = 'usb-kiosk'`, then returns the member preview and suggested action. The admin confirms through `POST /api/admin/kiosk/confirm`, which invokes the same `confirm_scan` transaction used by the legacy path. A read alone never changes attendance or points.

### Readers over Bluetooth

Two Server Actions, both for a signed-in organizer at AAL2. `pairReaderAction({ deviceId, epoch?, check? })` is called when a reader is connected by cable. If the reader already reports the current key's fingerprint it returns `{ ok, current: true }`; otherwise it writes a `reader.paired` audit row and returns the key for the browser to pass down the cable. It is limited to 20 new keys per organizer per 10 minutes. `openReaderSessionAction({ deviceId, epoch, clientNonce, readerNonce })` is called once per Bluetooth connection and returns the proof to send, the proof a genuine reader answers with, and the key for that session; never the pairing key. It is limited to 60 per organizer per minute and is not audited. The protocol is in `docs/usb-api.md`.

All other admin mutations are Server Actions (below). They require `getViewer().isAdmin` on the server and write an `audit_log` row; most finish with `redirect()` to the originating page with a notice/error query parameter. Link-returning actions instead return `{ ok, email, link }` to a client form (never a redirect URL), so tokens are not placed in browser history or server logs. Delivery is manual: the admin copies the link, sends it privately, and the app never calls an email provider.

### Admin Server Actions

| Area        | Actions                                                                                                                                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invitations | `createInvitationAction` (returns a one-time link), `regenerateInvitationLinkAction` (new link, reopening the invitation for 72 hours), `revokeInvitationAction`. Duplicate pending invitations blocked; the Auth user is rolled back if the invitation row fails. **No email is sent.** |
| Members     | `setMemberStatusAction`, `adjustMemberPointsAction`, `sendRecoveryAction` (returns a one-time link; no email). Reasoned and audited.                                                                                                                                                     |
| Cards       | `prepareUsbCardAction`, `activateUsbCardAction`, `revokeCardAction`. The legacy `prepareCardAction`/`completeWriteJobAction` remain server-side but are not exposed by the USB UI.                                                                                                       |
| Events      | `saveEventAction` (event + exactly one main session + optional bonus), `setEventStatusAction`.                                                                                                                                                                                           |
| Kiosk       | `previewUsbKioskAction` (USB read preview, transient scan), `confirmScanAction`, `correctAttendanceAction` — required reasons, audited state transitions.                                                                                                                                |
| Rewards     | `saveRewardAction`, `decideRedemptionAction` (approve/fulfil/reject/cancel with refund).                                                                                                                                                                                                 |
| Devices     | Legacy `createDeviceAction`, `updateDeviceAction` remain server-side only. There is no Devices tab; `/admin/devices` redirects to `/admin/cards`.                                                                                                                                        |
| MFA         | `/admin-mfa` actions `enrollMfaAction`, `verifyMfaAction` (Supabase TOTP, AAL2 required for `/admin/*`).                                                                                                                                                                                 |

## Server Actions

Server Actions are POST requests generated by Next for same-origin forms; they are not a documented public API. They return serializable state objects (`{ ok?, message?, error? }`) except where they finish with `redirect()`. All inputs are parsed with Zod; all require an authenticated session unless noted.

| Action                                    | File                                  | Auth                 | Behavior                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | ------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signInAction(prev, formData)`            | `app/(auth)/login/actions.ts`         | none                 | Email/password login via Supabase. Normalizes email. Rejects inactive memberships and signs out. Redirects member → `/member`, admin-only → `/admin`, otherwise `/invite/accept`. Returns a generic error for bad credentials.                                                                                        |
| `completeSetupAction(prev, formData)`     | `app/(auth)/invite/accept/actions.ts` | signed-in, no member | Requires name, password ≥12 with letter+digit, matching confirmation, consent, and a photo. Re-encodes the photo, sets the password, generates slug + public number, calls `complete_member_setup`, audits, redirects to `/member?welcome=1`. Retries on unique collisions; never creates a member without a profile. |
| `updateProfileAction(prev, formData)`     | `app/(member)/member/actions.ts`      | active member        | Validates display name (2–60), about (≤280), ≤6 `https://` links; optionally replaces the photo (2 MB, JPEG/PNG/WebP, re-encoded, old object deleted); audits before/after; revalidates member + public profile.                                                                                                      |
| `updatePrivacyAction(prev, formData)`     | same                                  | active member        | Reads all 12 visibility booleans, updates the profile, audits before/after, revalidates member/public/leaderboard.                                                                                                                                                                                                    |
| `requestRedemptionAction(prev, formData)` | same                                  | active member        | Validates reward id, quantity 1–5, idempotency key (8–64). Calls `redeem_reward` (server-computed cost/balance). Maps `insufficient_points`, `out_of_stock`, `reward_unavailable` to messages. Audits.                                                                                                                |
| `cancelRedemptionAction(formData)`        | same                                  | active member        | Verifies the redemption belongs to the caller and is `requested`/`approved`; calls `decide_redemption(action = cancel, reason = "Cancelled by member")`; audits; revalidates.                                                                                                                                         |

## Errors and validation

- Route handlers use `lib/api.ts`: `jsonOk` sets `Cache-Control: no-store`; `ApiError` maps to a stable `{ error: { code, message, requestId, details? } }` shape; unknown database errors are mapped for known domain codes and otherwise return a generic 500 with a request ID. Raw database errors are not returned.
- The two auth route handlers use the simpler `{ error: string }` shape described above.
- Server Actions return `{ error }` or `{ ok, message }` for display; they do not expose stack traces.
- Zod rejects unknown/oversized input at action boundaries. Photo files are limited to 2 MB and validated by decoding, not by filename.

## Idempotency and rate limiting

| Operation          | Mechanism                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Point/star grant   | `point_ledger.source_key` unique; `grant_points` returns the existing id on retry        |
| Attendance reward  | `source_key = attendance:<attendance id>`; one attendance per member/session             |
| Redemption request | unique `(member_id, idempotency_key)`; repeated key returns the same redemption          |
| Card write         | single-use job + nonce; completion rejects non-open jobs; read-back required for success |
| Token lookup       | fixed-window limiter in Postgres (`consume_rate_limit`)                                  |
| Invite acceptance  | `complete_member_setup` returns the existing member for the Auth user                    |

## Device API (legacy, retained for historical data)

Headers: `x-device-id`, `x-device-timestamp` (Unix seconds), `x-request-id` (unique nonce), and `x-device-signature` (lowercase HMAC-SHA-256); JSON bodies; HTTPS with certificate validation. The signed string is `METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(body)`. Device keys are encrypted server-side, signatures are compared in constant time, clocks must be within 120 seconds, and nonces are retained for ten minutes. Existing devices must rotate their secrets after migration 0007. Disabled/revoked devices are rejected; each device has a 120/min auth and 40/min scan budget.

| Method/path                               | Behavior                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/device/v1/heartbeat`           | Validates credentials, records last-seen/firmware, returns server-assigned mode and session.                                                                                                            |
| `POST /api/device/v1/scans`               | Validates a 43-char token, resolves the active card server-side, ensures the session window is open, and inserts a pending scan (unique per device/idempotency key). Never awards attendance or points. |
| `POST /api/device/v1/write-jobs/claim`    | Writer mode only; claims one queued job for this device, decrypts the short-lived card URL, marks it claimed.                                                                                           |
| `POST /api/device/v1/write-jobs/complete` | Reports `written`/`failed`; `written` requires read-back match; activates the card and destroys the job payload.                                                                                        |

Scan responses: `{ scanId, status, action, expiresAt }`; claim returns `{ job: null }` or `{ job: { id, cardUrl, expiresAt } }`. Tokens are never logged. The firmware client targets these exact paths.

| Method/path                                      | Purpose                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `POST /api/device/v1/heartbeat`                  | Authenticate device, report firmware/mode/diagnostics, receive server-assigned mode |
| `POST /api/device/v1/scans`                      | Submit one parsed card token + idempotency key; creates a pending scan only         |
| `POST /api/device/v1/write-jobs/claim`           | Claim one queued write job bound to this device                                     |
| `POST /api/device/v1/write-jobs/:jobId/complete` | Report written/failed with read-back result                                         |

TLS certificate validation is mandatory; payload size/content type, idempotency and rate limits are checked before any database write.
