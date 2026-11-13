# Route handlers and server actions

The app has two kinds of server entry point: route handlers under
`apps/web/src/app/api/` (and `/c/[cardToken]`), and Next.js server actions
called by its own forms and pages. Every one derives the person from the
verified session and checks their role in the database. Nothing trusts a role or
a member ID sent by the browser.

## Route handlers

| Route                           | What it does                                                           |
| ------------------------------- | ---------------------------------------------------------------------- |
| `POST /api/auth/session`        | Sets the session cookies for the older link flow. Same-origin only     |
| `POST /api/auth/signout`        | Ends this device's session and redirects to `/login`                   |
| `GET /c/[cardToken]`            | Sends a card's link to its owner's profile, or to `/card-unavailable`  |
| `GET /api/profile-photo/[slug]` | Serves a profile photo if the viewer may see it                        |
| `GET /api/public/leaderboard`   | A page of the public leaderboard                                       |
| `GET /api/public/events`        | Published public events                                                |
| `GET /api/public/events/[slug]` | One event and its sessions, or 404                                     |
| `POST /api/admin/kiosk/confirm` | Confirms or rejects a kiosk preview. Organizers only, same-origin only |

### `GET /c/[cardToken]`

- The token must match `^[A-Za-z0-9_-]{43}$`.
- It is hashed with SHA-256 and looked up among active cards. A match redirects
  (307, `no-store`) to `/m/<profile-slug>`.
- Anything else, including a card that was switched off and a rate-limited
  request, goes to `/card-unavailable` with nothing about any member.
- The limit is 120 lookups a minute per client address. It is per client rather
  than per token because a 256-bit token cannot be guessed, and a per-token
  bucket would let anyone add a database row for every random address.

### `POST /api/admin/kiosk/confirm`

Body: `{ scanId, action: 'check_in' | 'check_out' | 'reject', reason?, identityCheck? }`.
It calls `confirm_scan`, which does the whole change in one transaction, and
returns `{ ok, attendanceId }`. It is limited to 60 a minute per organizer. If
the member's photo changed in the last 48 hours, a check-in or check-out without
`identityCheck: true` is refused with 400, and a successful check is audited.

### Public JSON

All three set `Cache-Control: no-store` and return explicit fields only.
Leaderboard entries hold `rank`, `slug`, `displayName`, `photoUrl`,
`memberNumber` and `stars`, for members who are public, opted in, and share
their stars.

### Errors

Route handlers use `lib/api.ts`. `jsonOk` sets `no-store`; errors have the shape
`{ error: { code, message, requestId, details? } }`. Known database codes are
mapped to messages; anything else is a generic 500 with a request ID. The two
auth routes return the simpler `{ error: string }`.

## Server actions

A server action is a same-origin POST that Next.js generates; it is not a public
API, but it is a public endpoint, so each one checks the caller itself. Inputs
are parsed with Zod. An action behind a form people type into returns
`{ error }` so the form keeps what was typed; the rest redirect back with a
notice. Organizer actions need a session verified with an authenticator code,
and each writes an audit entry.

| Area            | Actions                                                                                                                | Who                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Sign-in         | `signInAction`, `confirmLinkAction`, `updatePasswordAction`                                                            | Anyone                                                |
| Setup           | `completeSetupAction`, `completeStaffSetupAction`, `enrollMfaAction`, `verifyMfaAction`                                | The signed-in person                                  |
| Member          | `updateProfileAction`, `updatePrivacyAction`, `requestRedemptionAction`, `cancelRedemptionAction`                      | An active member, for themselves                      |
| Invitations     | `createInvitationAction`, `regenerateInvitationLinkAction`, `revokeInvitationAction`                                   | Organizers                                            |
| Organizers      | `inviteAdministratorAction`, `changeUserRoleAction`                                                                    | Superadmins                                           |
| Access          | `revokeUserAccessAction`                                                                                               | Organizers for a member; superadmins for an organizer |
| Members         | `setMemberStatusAction`, `adjustMemberPointsAction`, `sendRecoveryAction`, `correctAttendanceAction`                   | Superadmins                                           |
| Cards           | `searchCardHoldersAction`, `findCardHolderAction`, `prepareUsbCardAction`, `activateUsbCardAction`, `revokeCardAction` | Organizers                                            |
| Kiosk           | `previewUsbKioskAction`, `previewKioskLookupAction`, `searchKioskMembersAction`                                        | Organizers                                            |
| Events, rewards | `saveEventAction`, `setEventStatusAction`, `saveRewardAction`, `decideRedemptionAction`                                | Organizers                                            |
| Readers         | `openReaderSessionAction`, `registerReaderAction`, `rotateReaderKeyAction`, `confirmReaderKeyAction`                   | Organizers                                            |
| Delete for good | `deleteRecordAction`                                                                                                   | Superadmins                                           |

Actions that make a one-time link return it to the form (`{ ok, email, link }`)
and never put it in a redirect, so it stays out of browser history and server
logs. The organizer copies it and sends it by hand.

### Kiosk preview

`previewUsbKioskAction` takes the link read from a card;
`previewKioskLookupAction` takes a member found by name, number or QR code. Each
checks the card, the member, the session and its check-in or check-out time, and
whether the photo changed recently, then creates a pending `device_scans` row
that expires in three minutes and returns the member's preview. Nothing else
changes until `/api/admin/kiosk/confirm`.

### Readers

`docs/usb-api.md` has the protocol. The four actions are its server side:

| Action                    | What it returns                                                        | Limit per organizer | Audited              |
| ------------------------- | ---------------------------------------------------------------------- | ------------------- | -------------------- |
| `openReaderSessionAction` | The proof to send, the proof a real reader answers with, a session key | 60 a minute         | No                   |
| `registerReaderAction`    | A new key for a reader on the cable that has none                      | 20 in 10 minutes    | `reader.paired`      |
| `rotateReaderKeyAction`   | The key that replaces a connected reader's                             | 20 in 10 minutes    | `reader.key_rotated` |
| `confirmReaderKeyAction`  | Nothing; retires the versions older than the one the reader holds      | None                | No                   |

`openReaderSessionAction` never returns a reader's key. The other two do,
because the browser has to pass it to the reader: in the clear down the cable
for a reader with no key, and inside the sealed session for a rotation.

## Idempotency

| Operation         | What makes a retry safe                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| Points and stars  | `point_ledger.source_key` is unique; `grant_points` returns the first grant        |
| Attendance reward | One attendance per member and session; its grant key changes only after a reversal |
| Reward request    | `(member_id, idempotency_key)` is unique; a repeat returns the same request        |
| Member setup      | `complete_member_setup` returns the member already made for that account           |
| Reader key change | Asking twice for the next version returns the key already stored                   |

## The retired device API

`/api/device/v1/*` and `GET /api/admin/kiosk/pending` belong to a WiFi reader
that no longer exists. They are still deployed, need a signed request from a
registered device, and none is registered. Do not build on them.
