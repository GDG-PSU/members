# Architecture

How the pieces fit and where trust ends. For the rules to follow when changing
them, see `AGENTS.md`; for tables and functions, [data-model.md](data-model.md).

## System shape

```text
Member / organizer browser
  └── HTTPS → Next.js App Router (Vercel)
                ├── Supabase Auth (email + password)
                ├── Postgres (RLS + transactional SQL functions)
                └── Supabase Storage (private `avatars` bucket)

Organizer browser (signed in, authenticator app verified)
  └── USB cable, or Bluetooth → ESP32 + PN532 card reader
        ├── /admin/cards  write a card and switch it on
        └── /admin/kiosk  read a card → preview → an organizer confirms
```

The reader has no WiFi and never reaches the network. Everything it does is
asked for by an organizer's browser, and the server is only involved through
that browser.

The repository is a pnpm workspace built with Turborepo:

| Path                    | What it is                                         |
| ----------------------- | -------------------------------------------------- |
| `apps/web`              | The one deployable app: Next.js, strict TypeScript |
| `packages/ui`           | Design tokens and components                       |
| `packages/contracts`    | Zod schemas and types shared across boundaries     |
| `supabase/migrations`   | Schema, policies, functions, storage               |
| `scripts`               | Database checks, reset, first admin                |
| `firmware/kiosk-reader` | The reader's firmware and its tools                |
| `tests/e2e`             | Playwright tests                                   |

## Trust boundaries

1. **Browser → server.** The browser holds only an HttpOnly session cookie.
   Every page, server action and route handler checks the session and the
   person's role again on the server. What the page shows is never
   authorization.
2. **Server → database.** Reads on behalf of a signed-in person use their own
   token, so Postgres RLS applies. Privileged writes use the service key, only
   after an authorization check, and go through SQL functions that own each
   transition. The API roles can reach almost nothing: `anon` reads published
   events, and `authenticated` reads its own rows.
3. **Public → data.** Public pages read two projections, `public_profiles` and
   `leaderboard`, which leave hidden fields out in the database. No public
   response is built from a table row or an Auth user.
4. **Reader → browser → server.** A reader obeys only a session opened with its
   own key, on its cable and over Bluetooth alike. The website holds that key
   and the browser does not: the server answers the handshake for a signed-in
   organizer and returns a key for that one session. So a reader in the wrong
   hands does nothing, and neither does one whose organizer lost their access.
   [usb-api.md](usb-api.md) has the protocol and its limits.
5. **Card → attendance.** A card holds a link and can be copied. Reading one
   creates a short-lived preview. An organizer checks the person against their
   photo and confirms, and only then is anything recorded.

## Signing in

- There is no public sign-up. An organizer makes an invitation; the app issues a
  one-time link of its own and the organizer sends it by hand, because there is
  no email provider. Password resets work the same way, from a superadmin.
- Only the hash of a link's token is stored (`sign_in_links`). Opening the link
  shows a Continue button, so a chat preview cannot use it up. Pressing Continue
  spends it and signs the person in.
- A new member sets a password, uploads a face photo and fills in a profile;
  `complete_member_setup` creates the member in one transaction and can be
  retried safely.
- Organizers also verify an authenticator app code. Admin pages and the
  database's admin policies both require that verified session (AAL2).

## Attendance and points

```text
card read, QR code, or an organizer finding the member by name
  → previewUsbKioskAction checks the card, the member and the session's times
  → a pending scan that expires in 3 minutes
  → the organizer checks the photo (and a PSU ID after a recent photo change)
  → POST /api/admin/kiosk/confirm → confirm_scan
       check-in, then later check-out
       points and stars are granted on a check-out inside the event's times
```

`confirm_scan` locks the scan and does everything in one transaction. A second
check-in, a check-out with no check-in, an expired preview and a scan outside
the session's times all fail with stable codes that the page turns into plain
messages.

## Why balances are sums

Points are value and attendance is a record, so neither can be quietly edited.

- The ledgers are append-only, enforced by triggers.
- A balance is always the sum of its ledger; there is no balance column.
- A correction is a new entry with an actor and a reason.
- Every grant has a unique source key, so a retry grants nothing twice.
- A reward's cost and an event's points are copied onto the entry that used
  them, so later edits do not rewrite history.

Redeeming a reward locks the member and the reward, checks the balance and the
stock inside the transaction, and returns the same redemption for a repeated
request.

## What a serverless host rules out

Vercel functions are short-lived and share no memory, so rate limits and locks
live in Postgres, uploads go to Storage, and there are no background jobs.

## When something fails

| Failure                    | What happens                                                     |
| -------------------------- | ---------------------------------------------------------------- |
| The reader disconnects     | The page says so; nothing is recorded. Check in by name instead  |
| The same card tapped twice | One preview; the second confirmation is refused                  |
| A request is retried       | The SQL function returns what the first attempt made             |
| A photo upload fails       | The form says why; no profile is saved without a photo           |
| Supabase is unreachable    | Pages fail closed. Nothing falls back to what the browser claims |

## Older parts still in the code

A WiFi version of the reader once called the server itself. Its endpoints
(`/api/device/v1/*`, `/api/admin/kiosk/pending`), tables (`devices`,
`card_write_jobs`) and helpers (`lib/devices`) remain for historical rows and
their tests. Nothing current uses them, and nothing new should.
