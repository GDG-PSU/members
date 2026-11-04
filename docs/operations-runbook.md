# Operations runbook

> **Current hardware note (2026-11-04):** The supported lane is USB-only.
> Prepare a card URL at `/admin/cards`, write it with the PN532 through Web Serial,
> verify the read-back, then activate it. There is no device registration,
> WiFi, heartbeat, HMAC secret, kiosk scan queue, or writer-job operation for
> this lane. The same lane powers `/admin/kiosk`; select a session, read a card,
> verify the member, and confirm attendance. The retired `/admin/devices` URL
> redirects to `/admin/cards`.

Audience: GDG@PSU organizers with admin access. Support address: **gdg@psu.edu**.

## Current availability (read first)

This checkout contains the database, public site, auth/invite/setup, member portal, admin portal, USB writer and kiosk UI, and firmware project. The legacy device middleware API remains for historical data only. The software steps below are available today. Steps that depend on physical hardware remain marked **[pending]**. Email is manual: admins generate links in the portal and send them from their own mailbox.

Never award attendance or points "to fix it later" without a reason and an audit record. Never edit ledger rows.

## Admin authenticator (TOTP)

Admin routes require AAL2. Enrollment in the target project has not been verified. The first administrator must enroll an authenticator through `/admin-mfa` and verify sign-in; do not assume an existing factor or local key belongs to the target project.

To enroll a replacement device, reset the existing factor in Supabase Auth (an organizer with account access), then run:

```bash
pnpm admin:enroll-totp
```

The script signs in with the credentials file, completes the app's own `/admin-mfa` enrollment, verifies an AAL2 session and writes the new manual key to `.local/gdg-admin-totp.txt` without printing it. Lost device recovery always requires the Supabase Auth reset; there are no recovery codes.

## Preflight (day before / morning of)

1. **Event and sessions:** publish the event with exactly one main session; add bonus sessions only if they need their own check-in/out. Confirm windows, minimum duration and reward points.
2. **USB lane:** connect the reader at `/admin/cards` and confirm `info` reports NFC ready. There is no server registration or lane label. **[pending hardware]**
3. **Pages:** admin and kiosk pages load with AAL2, server time is sane, and the HTTPS certificate is valid. The reader itself does not use the network.
4. **Test card:** perform a write test only on a non-production test card. **[pending writer + hardware]**
5. **Admin access:** sign in with password + TOTP, kiosk open on the tablet/laptop, and photos load. **[target-project enrollment unverified]**
6. **Offline plan:** know the support email flow and where the manual attendance log is kept if the API is down. Card reads are never buffered/replayed as verified attendance.

## USB kiosk operation during an event

1. Connect the reader at `/admin/kiosk` and select the event/session. Confirm the connection status shows the expected firmware and NFC readiness. **[pending hardware]**
2. Tap the member's card. The page shows the member name/photo and current attendance state. **Nothing is awarded yet.** If it says **Photo changed in the last 48 hours**, ask for the member's PSU ID.
3. An organizer compares the person to the photo, and for a recent photo change matches the PSU ID and ticks **I checked this member's PSU ID**. Then press **Confirm check-in**; the server rejects the confirmation if the check is missing. Duplicate reads show a clear "already checked in" state.
4. At the end, tap the card again; the organizer confirms **Check-out**. The server computes duration. Only at/over the session threshold are points and stars added.
5. A member who leaves without checkout gets no attendance. Do not confirm a checkout they did not make.
6. Bonus sessions are separate: read and confirm them independently. A main-session check-out does not qualify a bonus session.
7. If the lane is slow or disconnected, reconnect it and retry. Use the digital ID and an audited manual correction rather than inventing a scan.

### Writing or replacing a card

1. Open `/admin/cards`, select the member, and prepare one pending card URL.
2. Connect the lane, insert a blank/eligible NFC tag, and write the URL. The firmware writes exactly one NDEF HTTPS URL and reads it back. Success requires an exact read-back match; failure yields a clear code. **[pending hardware]**
3. Verify the browser read-back matches the prepared URL, then activate the card. The previous card (if any) is revoked and the member can use the digital ID.
4. Never write a card for a member whose identity/photo you have not verified. Do not leave a prepared URL active overnight.

## Lost, stolen or replaced card

1. Revoke the card immediately in the admin portal (reason required).
2. The `/c/` link stops redirecting; the member's `/m/` profile URL is unchanged.
3. Prepare and write a replacement; the previous card is marked replaced. Do not reuse a lost card's token.
4. Tell the member their digital ID is the fallback until the new card is active.

## Attendance correction

Corrections are admin-only, require a reason, and are audited.

- **Missed checkout:** set the checkout time (within reason), then qualify. The server issues the reward once, with `source_key = attendance:<id>`.
- **Wrongly qualified:** disqualify; the server writes a compensating reversal in both ledgers. It does not delete the original grant.
- **Wrong session:** do not edit history. Reject/annotate and ask an organizer to handle it through the documented correction path.
- If a member emails support, verify from their registered address, inspect the attendance row and audit trail, then act. Never accept a screenshot as proof of attendance.

## USB lane management

- **Reconnect:** close the kiosk/writer tab or use **Disconnect**, then reconnect and select the port again. Do not open two admin tabs against the same lane.
- **Lost or untrusted reader:** stop using it, remove physical access, and inspect recent `device_scans`/audit records. The reader has no server secret to rotate; it cannot reach the network on its own.
- **Browser support:** use a current Chrome or Edge build with Web Serial. Safari and Firefox are not supported.

## Incidents

| Incident                                                  | Immediate steps                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lost or untrusted USB reader                              | Stop using it, remove physical access, inspect recent scans/audit rows, and reflash a trusted unit if needed. The USB reader has no server credential.                                                                                                                                                                                                                        |
| Compromised admin account                                 | Revoke the role (`user_roles.revoked_at`), reset the TOTP factor in Supabase Auth, force sign-out/rotate credentials, review `audit_log`, check card/ledger changes                                                                                                                                                                                                           |
| Lost admin authenticator                                  | Reset the factor in Supabase Auth, sign in with the password, re-enroll with `pnpm admin:enroll-totp`; do not disable the AAL2 gate                                                                                                                                                                                                                                           |
| Bad ledger grant                                          | Do **not** delete. Use `reverse_grant` with actor + reason, then verify sums                                                                                                                                                                                                                                                                                                  |
| Card token list exposed                                   | Revoke affected cards, issue replacements; profile URLs unaffected                                                                                                                                                                                                                                                                                                            |
| Supabase/Vercel outage                                    | Post the offline notice, use manual attendance logging, allow no offline point awards; reconcile through audited corrections afterwards                                                                                                                                                                                                                                       |
| Failed migration                                          | Stop deploys; restore pre-migration dump into a disposable project; fix forward with a new migration                                                                                                                                                                                                                                                                          |
| Auth admin API returns 500 "Database error finding users" | Usually legacy `auth.users` rows created outside GoTrue with NULL token/metadata columns. Normalize `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`, `phone_change`, `phone_change_token`, `email_change_token_current`, `reauthentication_token` to `''` and metadata JSON to `'{}'`; retest `GET /auth/v1/admin/users` before blaming keys |
| Photo deleted/broken                                      | Member re-uploads; avatar falls back to initials meanwhile                                                                                                                                                                                                                                                                                                                    |

## Support email flow

1. Member emails **gdg@psu.edu** from their registered address.
2. Organizer verifies the sender against the member record; never disclose account details to a different address.
3. Password reset: admin opens the member, chooses **Generate recovery link** (audited), copies the one-time link and sends it from their own mailbox. Never email a password. Links expire per the project's Auth OTP setting; regenerate if needed.
4. Attendance/points issue: inspect attendance + ledger + audit; correct with a reason if warranted; reply with the outcome, not ledger internals.
5. Privacy/account closure: confirm identity, explain retention, follow `PRIVACY.md`; account deletion is reviewed because member ledger/attendance history is removed. Audit rows remain, retaining the actor UUID as an opaque historical identifier (migration 0005). Run the reviewed erasure as a service role or the `postgres` role, using the Auth user id from `auth.users`:

   ```sql
   select public.erase_member('AUTH_USER_ID_HERE');
   ```

   It removes the Auth user and cascades profiles, cards, attendance and ledger rows (migration 0009); it refuses unknown ids. `delete from auth.users` directly still fails by design while the append-only guards are active. Re-check `auth.users`, `members` and `storage.objects` afterwards, and delete the member's avatar objects under `member/<auth_user_id>/`.

6. Log the interaction in the internal support notes without pasting sensitive data into public channels.

## Closing an event

1. Confirm no kiosk preview is left open; close the kiosk/writer tabs and review the last confirmations.
2. Export or review attendance and reward totals; check for anomalies (duplicate rewards, zero-duration qualifications).
3. Mark the event completed (or cancelled) so it stops appearing as upcoming.
4. Record device status, incidents and corrections in the event notes.
5. Take a logical backup after high-value events if backups are not automated (`docs/backup-restore.md`).
