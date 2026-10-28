# Data model

The schema source of truth is `supabase/migrations/`. Never edit the hosted schema by hand; add a new migration. Migrations are applied with `pnpm db:migrate` (records applied files in `public.applied_migrations`) or the Supabase CLI (`supabase db push`).

Current migration order:

| File                   | Purpose                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `0001_schema.sql`      | Tables, constraints, indexes, updated-at triggers, append-only guards, helper functions |
| `0002_functions.sql`   | Transactional domain functions and public projections                                   |
| `0003_rls.sql`         | Row Level Security, grants, storage bucket and policies                                 |
| `0004_rate_limits.sql` | Postgres-backed fixed-window rate limiting                                              |

All instants are stored as `timestamptz` (UTC). Event wall-clock times are configured and rendered in `America/New_York` by the web app.

## Identity and membership

### `user_roles`

Server-assigned roles. Primary key `(auth_user_id, role)`; currently only `admin`. `revoked_at` null means active. No member-facing write policy exists.

`public.is_admin(uid)` is `SECURITY DEFINER`, `STABLE`, empty `search_path`, and checks for an unrevoked admin row.

### `member_invitations`

One row per invitation. Columns include normalized lowercase `email`, `status` (`pending`, `accepted`, `expired`, `revoked`), `paid_since`, optional internal `note`, Auth user reference, timestamps and `expires_at` (default +14 days).

- Partial unique index `member_invitations_one_live_pending` prevents two pending invitations for one email.
- No invitation token is stored; Supabase Auth owns the single-use link.
- Duplicate/expired/revoked handling is server-side. Acceptance is idempotent through `complete_member_setup`.

### `members`

Internal UUID, unique `auth_user_id` (FK `auth.users`), `status` (`active`, `suspended`, `archived`), unique public member number matching `^GDG-[A-Z0-9]{6}$`, `member_since`, and the accepting `invitation_id` (unique). A profile/card does not exist before acceptance.

`public.current_member_id()` resolves the signed-in Auth user to an active member.

### `member_private`

Admin-only identity data: `email` (normalized, indexed) and an optional `admin_note` (max 1000 chars). Kept separate from `member_profiles` so the public projection can never accidentally serialize it.

### `member_profiles`

One row per member: immutable `profile_slug` (22–64 URL-safe chars), required `display_name` (2–60), required `photo_path`, optional `about` (280), `links` JSONB array (max 6, application validates `https://`).

Visibility flags (all boolean, stored as columns):

`public_profile`, `show_display_name`, `show_photo`, `show_about`, `show_links`, `show_member_number`, `show_member_since`, `show_points`, `show_stars`, `show_events`, `show_on_leaderboard`, `show_email`.

Defaults are public, including `show_email`; members can hide email during setup. The public projection nulls fields according to these flags rather than relying on API filtering.

## Cards and one-time writes

### `card_credentials`

`member_id`, unique `token_hash` (SHA-256), `token_ciphertext` (AES-256-GCM envelope, used only for the member's authenticated digital ID and for write jobs), `status` (`pending`, `active`, `revoked`, `lost`, `replaced`), `issued_at`, revocation actor/reason, `replaces_card_id`, timestamps.

- A card row may exist as `pending` without a token.
- Partial unique index `card_credentials_one_active` allows at most one active card per member.
- Replacing a card revokes the previous one atomically through `prepare_card`/`activate_card`. A member's `/m/` URL never changes.
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

### `attendance_records`

Unique `(member_id, session_id)`. Stores check-in timestamp/actor, check-out timestamp/actor, `state` (`checked_in`, `completed`, `rejected`), computed `duration_minutes`, `qualified`, `reward_points` and `ledger_id`.

Points are granted only on confirmed check-out when `duration_minutes >= minimum_duration_minutes` and the session reward is positive. A bonus session has its own attendance row; it is never inferred from the main session.

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

### `devices`

Unique public `device_id` (`^[a-z0-9][a-z0-9-]{2,31}$`), lane label, `secret_hash` (only a verifier is stored), status (`active`, `disabled`, `revoked`), mode (`kiosk`, `writer`), optional event/session assignment, firmware/last-seen metadata, rotation timestamp.

Device credentials are independent of user identity. A secret is shown once at provisioning/rotation; the plaintext is never stored.

### `device_scans`

A scan is intent only: device, resolved member, card, session, suggested `action`, status (`pending`, `confirmed`, `rejected`, `expired`), unique `(device_id, idempotency_key)`, expiry (default 3 minutes), confirming admin. Attendance and points change only through `confirm_scan` from an authenticated admin action.

### `audit_log`

Append-only admin/security actions: action, target type/id, reason, redacted before/after JSON, request ID, actor, timestamp.

### `rate_limit_counters`

`(bucket, window_start)` primary key with hit count. `consume_rate_limit(bucket, limit, seconds)` is atomic and service-role only; used by public token lookups and device requests where implemented.

## Views

| View              | Security                                                                        | Exposure                |
| ----------------- | ------------------------------------------------------------------------------- | ----------------------- |
| `public_profiles` | Definer (owner `postgres`), explicit column projection                          | `anon`, `authenticated` |
| `leaderboard`     | Definer, filtered by public profile + points + leaderboard + display-name flags | `anon`, `authenticated` |
| `member_balances` | Security invoker, so base-table RLS applies                                     | `authenticated`         |

`public_profiles` returns only: slug, conditional display name/photo/about/links/member number/member-since/points/stars/attended-events/email, and `created_at`. It never returns internal UUIDs, Auth IDs, card data, notes or role information. Profiles with `public_profile = false` and non-active members are excluded.

`leaderboard` ranks deterministically by points desc, display name, slug; hidden members are excluded rather than counted as zero.

## Deletion, retention and corrections

- Attendance, ledger, audit and scan-confirmation history are append-only. Corrections use compensating entries with an actor and reason.
- Archiving/suspending a member removes them from public views immediately; records remain for dispute resolution.
- Deleting an Auth user cascades to member identity rows. Ledger entries cascade with the member, so account deletion must be treated as a deliberate, reviewed operation, not routine cleanup.
- Profile photos are stored in the public `avatars` bucket with random object paths; replacing a photo deletes the previous object.
- The schema has no automatic data-retention job. Retention periods must be decided by the organization (see `PRIVACY.md` and `docs/backup-restore.md`).

## Functions

| Function                     | Access                     | Notes                                    |
| ---------------------------- | -------------------------- | ---------------------------------------- |
| `set_updated_at()`           | trigger                    | Sets `updated_at`                        |
| `prevent_mutation()`         | trigger                    | Raises `append_only_relation`            |
| `is_admin(uid)`              | anon/authenticated/service | Role check                               |
| `current_member_id()`        | authenticated/service      | Resolves active member                   |
| `log_audit(...)`             | service_role               | Inserts audit row                        |
| `grant_points(...)`          | service_role               | Idempotent points + stars                |
| `reverse_grant(...)`         | service_role               | Compensating reversal                    |
| `redeem_reward(...)`         | service_role               | Atomic balance/inventory debit           |
| `decide_redemption(...)`     | service_role               | Status transitions + refund              |
| `prepare_card(...)`          | service_role               | Revokes previous, creates pending card   |
| `activate_card(...)`         | service_role               | Activates one card, supersedes others    |
| `revoke_card(...)`           | service_role               | Revokes pending/active card              |
| `queue_write_job(...)`       | service_role               | One-use encrypted URL payload            |
| `claim_write_job(...)`       | service_role               | Device-scoped claim with locking         |
| `complete_write_job(...)`    | service_role               | Read-back gate, payload destruction      |
| `complete_member_setup(...)` | service_role               | Idempotent invite acceptance             |
| `confirm_scan(...)`          | service_role               | Admin-confirmed attendance state machine |
| `correct_attendance(...)`    | service_role               | Audited corrections/reversals            |
| `consume_rate_limit(...)`    | service_role               | Atomic fixed-window limiter              |

All domain functions are `SECURITY DEFINER` with `search_path = ''` and schema-qualified objects. Write functions are revoked from `public` and granted only to `service_role`; the web server authorizes the actor before calling them.
