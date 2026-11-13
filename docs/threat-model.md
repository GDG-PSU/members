# Threat model

What could go wrong, what stops it, and what is left. Scope: member identity and
profiles, attendance, points and stars, rewards, cards, card readers, and
organizer actions. `docs/test-plan.md` records which of these controls are
tested.

Assets, by impact:

1. Points and reward stock (fraud, overspending).
2. Attendance history (fairness, eligibility).
3. Member data (email, photo, links) and account access.
4. Organizer accounts and the server's secrets.
5. Card links and reader keys (low direct impact; see the rows below).

## Threats

| Threat                     | Example                                                         | What stops it                                                                                                                                                                                  | What is left                                                                                                          |
| -------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Spoofing**               | A member acts as another account                                | Supabase Auth session cookies; the server derives the member from the verified user and never takes a member ID from the browser; RLS on member tables                                         | The server holds a service key, so a server compromise is high impact                                                 |
| Spoofing                   | A member changes their photo to pass as someone else            | A face photo is required; for 48 hours after a change the kiosk asks for a PSU ID and the server refuses a confirmation without it; the check is audited                                       | It rests on the organizer's judgment; there is no face matching                                                       |
| Spoofing                   | A card is copied                                                | A card only routes to a profile. Attendance needs an organizer's confirmation; the card's UID is never used                                                                                    | A copied link opens the same public profile                                                                           |
| Spoofing                   | Someone picks up a reader, or connects to one nearby            | The reader obeys only a session opened with its key. The site holds the key and answers the handshake only for a signed-in organizer with a verified authenticator; the browser never holds it | Over Bluetooth they can hold the reader's one connection for a few seconds at a time. The cable is unaffected         |
| Spoofing                   | A fake reader answers an organizer's browser                    | The reader must prove it holds its key before anything is sent to it; both sides' nonces are in every proof                                                                                    | A reader's flash can be read with tools, so a lost reader's key is treated as known until **Rotate key** is used      |
| Spoofing                   | An organizer whose access was removed keeps using a reader      | Every session is opened by a server action that re-checks the role and the authenticator, and is rate limited                                                                                  | A session already open lasts until the link drops or the reader restarts                                              |
| Spoofing                   | Someone erases a reader and takes it over                       | Erasing needs the reader in hand and a flashing tool. An erased reader takes a key only over its cable, and the site records who gave it one                                                   | A person with the tools can also install firmware of their own; the reader's flash is not protected against that      |
| **Tampering**              | A browser edits points                                          | No write policies for browsers; ledgers are append-only by trigger; grants and spends run in functions only the server can call; balances are sums                                             | None known at the database layer                                                                                      |
| Tampering                  | An organizer edits an event to inflate past rewards             | The points an attendance earned are stored on it and on the ledger entry                                                                                                                       | An organizer can still correct attendance, with a reason, on the record                                               |
| Tampering                  | The same scan or reward counted twice                           | One attendance per member and session; unique source keys; row locks in `confirm_scan` and `redeem_reward`                                                                                     | None known                                                                                                            |
| **Repudiation**            | An organizer denies a change                                    | `audit_log` and `attendance_audit_events` record the actor, time and reason; nothing can update or delete an audit row                                                                         | Logs are not shipped anywhere else                                                                                    |
| **Information disclosure** | A public profile leaks an email or an internal ID               | `public_profiles` leaves internal IDs out and nulls each hidden field in the database; email lives in a separate table                                                                         | The view bypasses RLS by design, so every column added to it needs review. Email is public unless the member hides it |
| Information disclosure     | Member A reads member B                                         | RLS through `current_member_id()`, checked by `pnpm db:verify`                                                                                                                                 | Server code using the service key must authorize first; this is a review rule, not a database one                     |
| Information disclosure     | Secrets in logs or bundles                                      | Secrets are server-only and never `NEXT_PUBLIC_`; card links, one-time links and reader keys are kept out of logs and the audit log                                                            | No secret scanning runs in CI                                                                                         |
| Information disclosure     | A one-time link leaks                                           | Only its hash is stored; it works once, for 72 hours (invitation) or 48 (password reset), and a new one replaces it; opening it does not spend it                                              | Whoever holds an unused link can use it                                                                               |
| Information disclosure     | Someone listens to a reader's link, or replays or alters a line | Every line after the handshake is sealed with AES-256-GCM under a key made for that session; a replayed or altered line ends the session; the reader's key is never sent in a handshake        | A reader's name and presence are visible to anyone scanning for Bluetooth                                             |
| Information disclosure     | The database leaks                                              | Reader keys and card links are stored sealed with a key the database does not hold; card links are looked up by hash                                                                           | Member data in the tables is not encrypted beyond what Supabase provides                                              |
| **Denial of service**      | Guessing card links, or bursts of sign-ins                      | 256-bit tokens; Postgres rate limits on card lookups, sign-in, authenticator codes, photo uploads, kiosk confirmations and reader sessions                                                     | The public read APIs have no rate limit; no load test has been run                                                    |
| DoS                        | A rush of reward requests drains stock                          | Locks and in-transaction stock and balance checks                                                                                                                                              | No queueing for extreme bursts                                                                                        |
| **Elevation of privilege** | A member makes themselves an organizer                          | Roles live in `user_roles`, which members cannot write; nothing is read from metadata or the email address                                                                                     | The first admin is created by an operator's script                                                                    |
| Elevation                  | An organizer without an authenticator                           | Admin pages and the database's admin policies both require a session verified with an authenticator code                                                                                       | A lost authenticator is reset in the Supabase dashboard                                                               |
| Elevation                  | A normal admin deletes records or reads the full audit log      | Deletes go through `delete_record`, which checks for a superadmin itself; superadmin pages and actions re-check the role                                                                       | None known                                                                                                            |

The retired WiFi reader API (`/api/device/v1/*`) is still deployed. It needs a
signed request from a registered device, and none is registered.

## Expected behavior in the awkward cases

- **A card read alone:** a preview that expires. No attendance, no points.
- **No check-out:** the attendance stays checked in and earns nothing.
- **A bonus session:** its own attendance; the main session never implies it.
- **A card that was switched off:** `/c/` shows the neutral unavailable page;
  the member's `/m/` page still works.
- **A private profile:** the public page shows the neutral unavailable state,
  and the leaderboard leaves the member out and does not count them as zero.
- **A photo changed in the last 48 hours:** the kiosk asks for a PSU ID and the
  confirm endpoint returns 400 without `identityCheck: true`.
- **A second invitation for the same email:** refused by a unique index.
- **Setup submitted twice:** the same member comes back; no duplicate.
- **Spending more than the balance:** the second request fails; the balance
  never goes negative.
- **Editing or deleting a ledger row:** the database raises
  `append_only_relation`.
- **A key change cut short:** the reader's old and new keys both work until the
  reader proves it holds the new one, so no reader is locked out.

## OWASP ASVS 5.0.0

A working checklist, not a certification.

| Area                      | Status      | Evidence, and the gap                                                                                                       |
| ------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| V1 Encoding and injection | Partial     | Parameterized queries and SQL functions; user text rendered as text. No dedicated XSS test.                                 |
| V2 Authentication         | Partial     | No public sign-up, 12-character passwords, authenticator for organizers, rate-limited sign-in. Covered by the browser suite |
| V3 Session management     | Partial     | HttpOnly cookies, server-side `getUser()`, refresh handled in the proxy. Cookie flags are tested; expiry edge cases are not |
| V4 Access control         | Tested (DB) | RLS isolation and API role privileges in `pnpm db:verify`. Route-level tests cover the admin and superadmin split           |
| V5 Validation             | Partial     | Zod at server boundaries, `https://` links only, photos re-encoded, explicit public projections                             |
| V6 Cryptography           | Partial     | SHA-256 token hashes, AES-256-GCM for stored card links and reader keys and for reader sessions. Keys are env secrets       |
| V7 Errors and logging     | Partial     | Stable error codes and request IDs; an audit log nothing can change. No central log shipping                                |
| V8 Data protection        | Partial     | Per-field visibility enforced in the database. No automatic retention job                                                   |
| V9 Communications         | Partial     | HTTPS throughout. HSTS is left to the host                                                                                  |
| V10 Malicious code        | Not tested  | `pnpm audit` is run by hand; no secret scanning                                                                             |
| V11 Business logic        | Tested (DB) | Idempotent grants, attendance rules, bonus sessions, stock and balance locks                                                |
| V12 Files                 | Partial     | 2 MB limit, format read from the file, metadata stripped, random paths in a private bucket                                  |
| V13 API                   | Partial     | Schema validation, same-origin checks on session routes, `no-store` on private responses                                    |
| V14 Configuration         | Partial     | Security headers in `next.config.ts`. Hosted Auth settings are checked by hand (`docs/deployment.md`)                       |
