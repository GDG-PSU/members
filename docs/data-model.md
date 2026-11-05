# Data model

> **Current hardware note (2026-11-04):** The USB reader does not use devices,
> device secrets, or card write jobs. The USB kiosk does use a short-lived
> `device_scans` row with `device_id = null` as preview state before the admin
> confirms; no device is registered. Cards are stored in `card_credentials`:
> `prepare_card` creates a pending credential, the admin writes its URL locally,
> and `activate_card` marks it active and replaces the member's previous card.
> Legacy device tables are retained for historical records only.

The schema source of truth is `supabase/migrations/`. Never edit the hosted schema by hand; add a new migration. Use the Supabase CLI (`supabase db push`) or its GitHub integration as the single migration authority. The legacy `pnpm db:migrate` records a separate history and must never be mixed with the CLI.

Current migration order:

| File                                  | Purpose                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `0001_schema.sql`                     | Tables, constraints, indexes, updated-at triggers, append-only guards, helper functions |
| `0002_functions.sql`                  | Transactional domain functions and public projections                                   |
| `0003_rls.sql`                        | Row Level Security, grants, storage bucket and policies                                 |
| `0004_rate_limits.sql`                | Postgres-backed fixed-window rate limiting                                              |
| `0005_audit_actor_retention.sql`      | Preserve audit actor identifiers                                                        |
| `0006_profile_privacy.sql`            | Private photos and activation privacy controls                                          |
| `0007_device_signatures.sql`          | Signed device requests and replay protection                                            |
| `0008_admin_rls_mfa.sql`              | MFA enforcement for admin database policies                                             |
| `0009_controlled_erasure.sql`         | Controlled erasure without weakening append-only guards                                 |
| `0010_photo_identity.sql`             | Photo-change timestamp and the 48-hour kiosk identity window                            |
| `0011_usb_kiosk.sql`                  | Allows the transient USB-kiosk scan row with no registered device                       |
| `0012_superadmins.sql`                | Superadmin role, narrower admin read policies                                           |
| `0013_exclusive_user_types.sql`       | `set_user_type`: a user is exactly one of member, admin, superadmin                     |
| `0014_security_hardening.sql`         | Closes API access to privileged functions and columns; hardens domain transitions       |
| `0015_kiosk_check_in_methods.sql`     | Records whether each check-in and check-out was by card, QR code or an organizer        |
| `0016_leaderboard_by_stars.sql`       | Ranks the leaderboard by lifetime stars                                                 |
| `0017_organizer_profiles.sql`         | Gives staff a profile and card through `members.kind = 'organizer'`                     |
| `0018_organizer_profile_backfill.sql` | A placeholder organizer profile for each existing staff account                         |
| `0019_superadmin_delete.sql`          | Permanent delete for superadmins, and an audit log nothing can change                   |
| `0020_sign_in_links.sql`              | One-time invitation and reset links the app owns: 72 and 48 hours                       |

All instants are stored as `timestamptz` (UTC). Event wall-clock times are configured and rendered in `America/New_York` by the web app.

## Identity and membership

### `user_roles`

Server-assigned roles. Primary key `(auth_user_id, role)`; `admin` or `superadmin`. `revoked_at` null means active. No member-facing write policy exists. The `user_roles_keep_last_superadmin` trigger refuses to revoke or delete the last active superadmin, whichever code path tries it, and takes a lock so concurrent revocations cannot both succeed. Only a reviewed `erase_member` is exempt.

`public.is_admin(uid)` and `public.is_superadmin(uid)` are `SECURITY DEFINER`, `STABLE`, empty `search_path`, and check for an unrevoked role row, an AAL2 session and `uid = auth.uid()`.

### `member_invitations`

One row per invitation. Columns include normalized lowercase `email`, `status` (`pending`, `accepted`, `expired`, `revoked`), `paid_since`, optional internal `note`, Auth user reference, timestamps and `expires_at`, which is when its link stops working: 72 hours after the link was made, and again after each New link. Past that the People page shows the invitation as not accepted.

- Partial unique index `member_invitations_one_live_pending` prevents two pending invitations for one email.
- No invitation token is stored; Supabase Auth owns the single-use link.
- Duplicate/expired/revoked handling is server-side. Acceptance is idempotent through `complete_member_setup`.

### `members`

Internal UUID, unique `auth_user_id` (FK `auth.users`), `status` (`active`, `suspended`, `archived`), unique public member number matching `^GDG-[A-Z0-9]{6}$`, `member_since`, and the accepting `invitation_id` (unique). A profile/card does not exist before acceptance.

`kind` is `member` or `organizer`. An organizer row belongs to a staff account and exists only to carry their profile and card: triggers refuse it points, stars, attendance and reward requests, the leaderboard excludes it, and the public projection never shows member numbers for it. An organizer's `photo_path` may be null; a member's may not.

`public.current_member_id()` resolves the signed-in Auth user to an active member.

### `member_private`

Admin-only identity data: `email` (normalized, indexed) and an optional `admin_note` (max 1000 chars). Kept separate from `member_profiles` so the public projection can never accidentally serialize it.

### `member_profiles`

One row per member: immutable `profile_slug` (22–64 URL-safe chars), required `display_name` (2–60), required `photo_path` (a clear face photo), `photo_changed_at` (when the current photo was uploaded), optional `about` (280), `links` JSONB array (max 6, application validates `https://`).

`photo_changed_at` defaults to the insert time and a trigger advances it whenever `photo_path` changes. The kiosk treats a value inside 48 hours as an unverified identity claim and requires a PSU ID check before attendance confirmation; the confirm endpoint enforces the same rule server-side.

Visibility flags (all boolean, stored as columns):

`public_profile`, `show_display_name`, `show_photo`, `show_about`, `show_links`, `show_member_number`, `show_member_since`, `show_points`, `show_stars`, `show_events`, `show_on_leaderboard`, `show_email`.

Defaults are public, including `show_email`; members can hide email during setup. The public projection nulls fields according to these flags rather than relying on API filtering.

## Cards and one-time writes

### `card_credentials`

`member_id`, unique `token_hash` (SHA-256), `token_ciphertext` (AES-256-GCM envelope), `status` (`pending`, `active`, `revoked`, `lost`, `replaced`), `issued_at`, revocation actor/reason, `replaces_card_id`, timestamps. `token_hash` and `token_ciphertext` are not readable through the API; only the server uses them.

- A card row may exist as `pending` without a token.
- Partial unique index `card_credentials_one_active` allows at most one active card per member.
- `prepare_card` supersedes only an earlier unwritten card. The active card keeps working until `activate_card` replaces it, so an abandoned or failed write never strands a member. A lost card is revoked explicitly with `revoke_card`. A member's `/m/` URL never changes.
- Plaintext tokens are never stored and never logged.

### `card_write_jobs`

`device_id`, `member_id`, `card_id`, encrypted `payload_ciphertext`, single-use `nonce`, `status` (`queued`, `claimed`, `written`, `failed`, `expired`, `cancelled`), expiry (30–900 seconds), claim/attempt metadata and bounded result JSON.

`queue_write_job` cancels prior open jobs for the card and requires an active device in `writer` mode. `claim_write_job` expires stale jobs and claims one `queued`, unexpired job with `FOR UPDATE SKIP LOCKED`. `complete_write_job` requires a read-back match for success, activates the card, and overwrites the payload with the literal `destroyed`.

## Events and attendance

### `events`

Name, unique slug, summary, location, start/end, status (`draft`, `published`, `cancelled`, `completed`), public visibility, creator, timestamps.

### `event_sessions`

Belongs to an event; `kind` (`main` or `bonus`); start/end; check-in window (`check_in_opens_at`/`check_in_closes_at`); check-out window; `minimum_duration_minutes` (0–1440); `reward_points` (0–10000); `is_enabled`; `reward_policy` JSONB snapshot.

- Partial unique index `event_sessions_one_main` enforces exactly one main session per event.
- Rewards are snapshotted on the attendance/ledger rows so later edits do not rewrite history.

The event form does not ask for the four window times or a minimum duration. An organizer picks how late someone may arrive and how early they may leave, and the windows are derived from those (`apps/web/src/lib/events/attendance-rules.ts`). Sessions saved through the form have `minimum_duration_minutes = 0`; the column and its rule remain for older rows.

### `attendance_records`

Unique `(member_id, session_id)`. Stores check-in timestamp/actor, check-out timestamp/actor, `state` (`checked_in`, `completed`, `rejected`), computed `duration_minutes`, `qualified`, `reward_points`, `ledger_id`, and how the member was identified at each step: `check_in_method` and `check_out_method` (`card`, `qr` or `manual`).

Points are granted only on confirmed check-out when `duration_minutes >= minimum_duration_minutes` and the session reward is positive. A bonus session has its own attendance row; it is never inferred from the main session.

A grant that was reversed by a correction spends its source key, so `attendance_grant_key` gives the next grant for that attendance a new one (`attendance:<id>:<n>`). An unreversed grant keeps its key, which keeps retries idempotent. `confirm_scan` re-checks the member, card and event before confirming, because they can change while a scan is pending.

### `attendance_audit_events`

Append-only sequence: `scan_received`, `check_in_confirmed`, `check_out_confirmed`, `rejected`, `admin_correction`, with actor, device, reason, request ID and metadata. No card tokens.

## Ledger

### `point_ledger`

Append-only. Identity `id`, `member_id`, non-zero `delta`, `kind` (`attendance_reward`, `interaction_reward`, `redemption`, `redemption_refund`, `reversal`, `admin_adjustment`), unique `source_key`, description, actor, optional event/session/redemption, `rule_snapshot`, timestamp.

### `star_ledger`

Append-only, lifetime, non-spendable. Every positive point grant writes an equal star entry (`star:<source_key>`); spends never write stars. Reversals mirror negative stars.

Balances are always derived (`sum(delta)`), either in `member_balances` (security-invoker view, so RLS limits rows) or inside a transaction. There is no mutable balance column.

`grant_points` is idempotent by `source_key` and writes both ledgers in one transaction. `reverse_grant` refuses to reverse non-grant kinds, requires a reason, refuses to push the balance negative, and writes `reversal:<ledger id>` plus a mirrored star reversal. Both `point_ledger` and `star_ledger` have `BEFORE UPDATE OR DELETE` triggers raising `append_only_relation`.

## Rewards and redemptions

### `rewards`

Name, description, `cost_points`, nullable `inventory`, `is_active`, fulfillment note, audit fields.

### `redemptions`

Member, reward, snapshotted reward name/unit cost, quantity (1–5), points debited, status (`requested`, `approved`, `fulfilled`, `cancelled`, `rejected`), unique `(member_id, idempotency_key)`, decision/fulfilment metadata.

`redeem_reward` locks the member row then the reward row, checks inventory and the ledger-derived balance inside the transaction, writes the negative ledger entry, decrements inventory, and returns the same redemption for a repeated idempotency key. `decide_redemption` handles approve/fulfil/reject/cancel; reject/cancel insert a `redemption_refund` entry and restock inventory. Stars are untouched.

## Devices, scans, audit, rate limits

### `devices` (legacy)

Unique public `device_id` (`^[a-z0-9][a-z0-9-]{2,31}$`), lane label, `secret_hash` (only a verifier is stored), status (`active`, `disabled`, `revoked`), mode (`kiosk`, `writer`), optional event/session assignment, firmware/last-seen metadata, rotation timestamp.

Device credentials are independent of user identity. A secret is shown once at provisioning/rotation; the plaintext is never stored.

### `device_scans`

A scan is intent only: optional device (null for the USB kiosk), resolved member, card, session, suggested `action`, status (`pending`, `confirmed`, `rejected`, `expired`), expiry (default 3 minutes), confirming admin. The USB kiosk creates a short-lived pending row from `previewUsbKioskAction`; attendance and points change only through `confirm_scan` from an authenticated admin action.

### `sign_in_links`

One row per person who has been sent an invitation or password reset link: the SHA-256 hash of the link's token, its purpose (`member_invite`, `staff_invite`, `recovery`), the Auth user it is for, who made it, `expires_at` and `used_at`. The token and the link are never stored. A check constraint refuses a lifetime over 72 hours. RLS is on with no policies, so only the server reads it. `issue_sign_in_link` replaces the person's earlier link; `redeem_sign_in_link` spends one in a single statement if it is unused and unexpired.

### `audit_log`

Append-only admin/security actions: action, target type/id, reason, redacted before/after JSON, request ID, actor, timestamp. Since migration 0019 its guard has no exception: no role, function or erasure can update or delete a row. Only `pnpm db:reset`, which truncates every table, empties it.

### `rate_limit_counters`

`(bucket, window_start)` primary key with hit count. `consume_rate_limit(bucket, limit, seconds)` is atomic and service-role only. It backs card lookups (per client), sign-in (per client and per account), TOTP verification and photo uploads (per account), kiosk confirmation and device requests. Client addresses and emails are hashed before they become bucket names.

## Views

| View              | Security                                                                       | Exposure        |
| ----------------- | ------------------------------------------------------------------------------ | --------------- |
| `public_profiles` | Definer (owner `postgres`), explicit column projection                         | `service_role`  |
| `leaderboard`     | Definer, filtered by public profile + stars + leaderboard + display-name flags | `service_role`  |
| `member_balances` | Security invoker, so base-table RLS applies                                    | `authenticated` |

The public pages and `/api/public/*` read the two projections with the server-only client, one profile or one bounded page at a time. They are not exposed through the Supabase API, where anyone holding the publishable key could dump them.

`public_profiles` returns only: slug, conditional display name/photo/about/links/member number/member-since/points/stars/attended-events/email, and `created_at`. It never returns internal UUIDs, Auth IDs, card data, notes or role information. Profiles with `public_profile = false` and non-active members are excluded.

`leaderboard` ranks deterministically by lifetime stars desc, display name, slug, so spending points never lowers a rank. It lists members who share their stars and display name and opted in; hidden members are excluded rather than counted as zero.

## Deletion, retention and corrections

- Attendance, ledger, audit and scan-confirmation history are append-only. Corrections use compensating entries with an actor and reason.
- Archiving/suspending a member removes them from public views immediately; records remain for dispute resolution.
- Account closure runs through `erase_member(auth_user_id)` (migration 0009), which sets a transaction-local flag, deletes the Auth user and lets identity, card, attendance and ledger rows cascade. The append-only triggers still reject every ordinary `UPDATE`/`DELETE`; the flag exists only inside that function's transaction. Treat erasure as a deliberate, reviewed operation, not routine cleanup.
- A superadmin can delete a record for good through `delete_record(kind, id, actor)` (migration 0019): an event with its sessions and attendance, a reward with its handled requests, a handled reward request, a card, an attendance record that gave no points, an invitation with the unused account made for it, or a person's whole account. The function checks that the actor is a superadmin, deletes, and writes a `<kind>.deleted` audit entry in the same transaction. The entry carries the name of a deleted event or reward, and nothing that identifies a deleted person.
- A delete never takes points or stars back. Ledger rows that pointed at a deleted event or request keep their amount and description and lose only the link. A reward with a request still waiting, and an attendance that gave points, are refused until they are decided or corrected.
- Profile photos are stored in the private `avatars` bucket and served through an authorization-aware endpoint; replacing a photo deletes the previous object, and deleting an account deletes its photos.
- The schema has no automatic data-retention job. Retention periods must be decided by the organization (see `PRIVACY.md` and `docs/backup-restore.md`).

## Functions

| Function                      | Access                | Notes                                                              |
| ----------------------------- | --------------------- | ------------------------------------------------------------------ |
| `set_updated_at()`            | trigger               | Sets `updated_at`                                                  |
| `prevent_mutation()`          | trigger               | Raises `append_only_relation`                                      |
| `is_admin(uid)`               | authenticated/service | Role check used by RLS                                             |
| `is_superadmin(uid)`          | authenticated/service | Role check used by RLS                                             |
| `current_member_id()`         | authenticated/service | Resolves active member                                             |
| `set_user_type(...)`          | service_role          | Exclusive member/admin/superadmin conversion, keeping the profile  |
| `complete_staff_profile(...)` | service_role          | Creates, or restores, a staff account's own organizer profile      |
| `log_audit(...)`              | service_role          | Inserts audit row                                                  |
| `grant_points(...)`           | service_role          | Idempotent points + stars                                          |
| `reverse_grant(...)`          | service_role          | Compensating reversal                                              |
| `redeem_reward(...)`          | service_role          | Atomic balance/inventory debit                                     |
| `decide_redemption(...)`      | service_role          | Status transitions + refund                                        |
| `prepare_card(...)`           | service_role          | Creates a pending card, supersedes an earlier unwritten one        |
| `activate_card(...)`          | service_role          | Activates one card, replaces the previous active card              |
| `revoke_card(...)`            | service_role          | Revokes pending/active card                                        |
| `queue_write_job(...)`        | service_role          | One-use encrypted URL payload                                      |
| `claim_write_job(...)`        | service_role          | Device-scoped claim with locking                                   |
| `complete_write_job(...)`     | service_role          | Read-back gate, payload destruction                                |
| `complete_member_setup(...)`  | service_role          | Idempotent invite acceptance                                       |
| `confirm_scan(...)`           | service_role          | Admin-confirmed attendance state machine                           |
| `correct_attendance(...)`     | service_role          | Audited corrections/reversals                                      |
| `consume_rate_limit(...)`     | service_role          | Atomic fixed-window limiter                                        |
| `erase_member(uid)`           | service_role          | Reviewed erasure; lifts append-only guard for its transaction only |
| `delete_record(kind, id, by)` | service_role          | Superadmin-only permanent delete with its audit entry              |
| `issue_sign_in_link(...)`     | service_role          | Stores a new one-time link and removes the person's earlier ones   |
| `redeem_sign_in_link(hash)`   | service_role          | Spends an unused, unexpired link; returns who it is for            |

All domain functions are `SECURITY DEFINER` with `search_path = ''` and schema-qualified objects. Write functions can be executed only by `service_role`; the web server authorizes the actor before calling them.

Supabase's default ACL grants `EXECUTE`, and full table privileges, to `anon` and `authenticated` directly, so `revoke ... from public` does not remove API access. Migration 0014 revokes those grants explicitly and removes the default ACL entries, so a new function or table in `public` starts closed. `pnpm db:verify` fails if any function other than the three RLS helpers becomes callable by an API role.
