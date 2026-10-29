# Threat model

Scope: member identity/profile data, attendance, points/stars, rewards inventory, cards, device credentials and admin actions.

Assets ranked by impact:

1. Points/inventory (loyalty value, fraud and overspend risk).
2. Attendance history (eligibility, fairness, event records).
3. Member PII (email, photo, links) and account access.
4. Admin/device credentials.
5. Card tokens (routing identifiers; low direct impact but used for stalking/enumeration if leaked).

## STRIDE summary

| Threat                     | Example                                                | Mitigations in this repository                                                                                                                                                      | Residual risk                                                                                                                                    |
| -------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Spoofing**               | Forged device posts scans                              | Per-device high-entropy secret encrypted server-side, HMAC signatures, timestamp and database nonce checks, device allowlist, scoped endpoints, TLS, and secret rotation            | Physical devices and replay handling on real hardware remain unverified; compromised firmware can expose its device key                          |
| Spoofing                   | Member impersonates another account                    | Supabase Auth PKCE/session cookies; server derives member from verified user; no client-supplied member IDs for self-service; RLS on member tables                                  | Publishable key is used for user queries; the server still holds a secret key for admin operations, so server compromise remains high-impact     |
| Spoofing                   | Member changes their photo to impersonate someone else | A clear face photo is required; the kiosk flags any photo changed within 48 hours, requires a PSU ID check, and the confirm API rejects attendance without it; the check is audited | Organizer judgment is still required; there is no automated face matching                                                                        |
| Spoofing                   | Card UID copied                                        | UID is never used as a credential; the NDEF URI token is resolved server-side; card possession grants only profile routing                                                          | A copied card link can be shared; it still cannot authorize attendance/points                                                                    |
| **Tampering**              | Client edits points/balance                            | No browser write policies; ledger tables append-only (triggers); all grants/debits through `security definer` functions restricted to `service_role`; balances derived from sums    | None known in DB layer                                                                                                                           |
| Tampering                  | Admin edits event config to inflate historical rewards | Reward rule snapshots on ledger and attendance; completed attendance stores reward points                                                                                           | An admin can still correct future/current attendance; audit records capture it                                                                   |
| Tampering                  | Duplicate scan/reward                                  | Unique `(device, idempotency_key)`, unique `(member, session)`, `source_key` idempotency, `FOR UPDATE` locks, single-use write jobs                                                 | Firmware/API must supply stable idempotency keys                                                                                                 |
| Tampering                  | Two lanes double check-in/out                          | Row locks in `confirm_scan`, unique attendance per member/session, scan status transition check                                                                                     | Concurrency tests at API level not yet run                                                                                                       |
| **Repudiation**            | Admin denies an adjustment                             | `audit_log` and `attendance_audit_events` require actor/timestamp/reason; append-only triggers                                                                                      | Audit access is admin-only; external log shipping not configured                                                                                 |
| **Information disclosure** | Public profile leaks email/internal ID                 | `public_profiles` project excludes internal IDs; email nulled unless `show_email`; separate `member_private` table; RLS                                                             | View is owned by `postgres` and bypasses RLS; any future column added to the view must be reviewed explicitly                                    |
| Information disclosure     | Member A reads member B                                | RLS policies scoped through `current_member_id()`; verified by database tests for ledger/profile                                                                                    | App-level queries using the secret client could bypass RLS if a route forgets authorization; code review + public projection discipline required |
| Information disclosure     | Secrets in logs/bundles                                | Secret keys server-only, `.env*` ignored, `.env.example` contains placeholders only; no card tokens in logs/audit payloads; firmware secrets ignored                                | Secret scanning has not been run; production Vercel env not configured                                                                           |
| Information disclosure     | Invitation/recovery token leaks                        | Supabase manages single-use links; app does not store tokens; admin recovery is audited; members are directed to support email                                                      | Email templates/allowlist not configured; link behavior in production unverified                                                                 |
| **Denial of service**      | Scan/token brute force or bursts                       | Token format + 256-bit entropy; `consume_rate_limit` Postgres limiter on `/c/`; device per-request schema/size limits (contract); short expiries                                    | Rate limits for admin/member endpoints and Vercel/WAF limits not configured; load test not run                                                   |
| DoS                        | Redemption races drain inventory                       | Row locks + in-transaction inventory/balance checks; unique idempotency; concurrency test passed (overspend rejected)                                                               | No queue/backpressure for extreme bursts                                                                                                         |
| **Elevation of privilege** | Member grants self admin                               | No member write policy on `user_roles`; admin status checked server-side from `user_roles`; roles not derived from email/metadata                                                   | Admin bootstrap script must be run by an operator                                                                                                |
| Elevation                  | Admin without MFA                                      | App enforces an AAL2 gate plus TOTP enrollment at `/admin-mfa`; session assurance checked server-side                                                                               | Enrollment/verification flow not yet covered by an automated test; Supabase MFA must be enabled in project settings                              |
| Elevation                  | Device claims another device's job                     | Job claim filtered by device UUID; completion checks `job.device_id`; device cannot pass member/event IDs                                                                           | Signed request and nonce replay checks are exercised locally; physical devices remain unverified                                                 |
| Elevation                  | Writer mode also accepts scans                         | Device mode stored server-side; queue requires `writer`; firmware must refuse simultaneous modes                                                                                    | Hardware/firmware test not run                                                                                                                   |

## Specific abuse cases and expected behavior

- **Scan alone:** creates a pending scan only; no attendance, no points, no profile change.
- **No checkout:** attendance remains `checked_in`; zero points; event history does not count it.
- **Below threshold:** `qualified = false`, no ledger row.
- **Bonus session:** separate attendance row; main-session attendance never implies bonus eligibility.
- **Revoked card:** `/c/` returns the neutral unavailable page; `/m/` still works.
- **Private profile:** public route renders neutral unavailable; leaderboard excludes the member; counts are not padded with hidden members.
- **Fresh photo:** the kiosk shows a 48-hour warning and the confirm API returns 400 until `identityCheck: true`; a successful check writes `attendance.identity_checked` to the audit log.
- **Duplicate invite:** partial unique index rejects a second pending invitation.
- **Double acceptance:** `complete_member_setup` returns the existing member id; no duplicate slug/number.
- **Overspend:** second concurrent redemption fails; balance never negative (verified).
- **Ledger edit/delete:** database raises `append_only_relation` (verified).

## OWASP ASVS 5.0.0 mapping

This is a working checklist, not a certification. "Tested" means an automated check in `scripts/db-verify.mjs` or a code-level control that was inspected; it does not mean the whole control family is complete.

| ASVS area                   | Status      | Evidence / gap                                                                                                                                                                                                                                |
| --------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 Encoding / injection     | Partial     | Parameterized Supabase queries and SQL functions; public text rendered as text. No dedicated XSS test.                                                                                                                                        |
| V2 Authentication           | Partial     | Supabase Auth, no public signup, invitation-only setup, password minimum 12 with letter+digit. Admin TOTP enrollment and the invitation/setup flow are E2E-tested; lockout and rate-limit behavior are not.                                   |
| V3 Session management       | Partial     | HttpOnly Supabase SSR cookies, server-side `getUser()`; cookie flags/refresh behavior not E2E-tested.                                                                                                                                         |
| V4 Access control           | Tested (DB) | RLS member isolation, private profile exclusion, anon ledger denial (38/38 db checks). Route-level IDOR tests pending.                                                                                                                        |
| V5 Validation/serialization | Partial     | Zod at server boundaries, size caps, `https://` link validation, image re-encode, explicit public API projections. The invitation/setup flow is automated; other authenticated admin endpoints are covered by typecheck and code review only. |
| V6 Cryptography             | Partial     | SHA-256 token hashing, AES-256-GCM encrypted card payloads, 256-bit tokens, constant-time comparison helper; key management relies on env secrets.                                                                                            |
| V7 Error/logging            | Partial     | Stable API error codes, request IDs, redacted audit JSON; no centralized log shipping or redaction test.                                                                                                                                      |
| V8 Data protection          | Partial     | Email separate and public by default with a member-controlled visibility flag, public allowlist view, no secrets in client bundles by construction. Retention/deletion policy not automated.                                                  |
| V9 Communications           | Partial     | HTTPS assumptions, TLS validation required in firmware contract, CSP/HSTS note; HSTS not yet configured, firmware not tested.                                                                                                                 |
| V10 Malicious code          | Not tested  | Dependency audit and secret scanning not run yet.                                                                                                                                                                                             |
| V11 Business logic          | Tested (DB) | Idempotent grants, attendance thresholds, no checkout → no points, bonus independence, inventory/balance locks.                                                                                                                               |
| V12 Files/resources         | Partial     | 2 MB limit, MIME + decode validation, random object paths, metadata stripped. Storage policy review pending.                                                                                                                                  |
| V13 API/web service         | Partial     | Schema validation, method/content-type checks, rate limiter, no-store; device API implemented and auth-tested.                                                                                                                                |
| V14 Configuration           | Partial     | Security headers configured in `next.config.ts`; deployment/env hardening not performed.                                                                                                                                                      |

## Explicitly not verified

- Physical NFC read/write, read-back, locked/full tag behavior, two-lane hardware concurrency.
- Campus network (eduroam/PSU IT) connectivity and certificate trust on the device.
- Vercel preview/production deployment, custom domain, cookies on the production origin, manual link delivery and Auth link expiry.
- Remaining authenticated admin browser flows (cards, kiosk, events, devices), axe/WCAG audit, visual review at target widths, load test.
- Dependency vulnerability audit, secret scan over Git history, backup/restore drill.

These are tracked as blockers in `README.md` and `docs/test-plan.md`.
