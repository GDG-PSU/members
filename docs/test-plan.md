# Test plan and results

## Verified on 2026-11-05

Environment: a production build (`next start`) on `http://localhost:3100` against
a local Supabase stack with every migration applied, plus one physical ESP32 +
PN532 on COM3 with a writable NTAG215. Nothing here ran against production.

| Check               | Command                       | Result                                         |
| ------------------- | ----------------------------- | ---------------------------------------------- |
| Formatting          | `pnpm format:check`           | Pass                                           |
| Lint / types        | `pnpm lint`, `pnpm typecheck` | Pass                                           |
| Unit tests          | `pnpm test`                   | 91/91 pass                                     |
| Production build    | `pnpm build`                  | Pass                                           |
| Browser E2E         | `pnpm e2e`                    | 56 pass, 36 skipped; 46/46 on desktop Chromium |
| Database/RLS/ledger | `pnpm db:verify`              | 114/114 pass on the local Supabase stack       |
| Firmware compile    | `pio run`                     | Pass; firmware 2.0.2                           |
| Physical reader     | USB JSON API on COM3          | 17/17 robustness checks on 2.0.2               |
| Physical end to end | Browser app + real reader     | Pass on 2.0.2; see Hardware coverage           |
| Camera QR scan      | Simulated camera, one-off     | Pass; check-in recorded as `qr`                |
| Reset and bootstrap | `pnpm db:reset`               | Pass on the local stack only; see Reset        |

The 36 skips are the signed-in specs on the mobile project, which run on desktop
only. On mobile, the 10 public specs pass, and one desktop test checks that member
and admin pages fit a phone-width viewport.

## What the browser suite covers

`tests/e2e/workflows.spec.ts` drives every workflow through the real UI, using
disposable accounts it creates and removes:

- **Access:** public sign-up refused, API keys refused on privileged functions,
  staff sign-in with TOTP, returning TOTP, HttpOnly cookies, cross-site session
  posts refused, normal-admin limits, and the login rate limit.
- **Navigation:** the five admin tabs and four member tabs, which tab each page
  lights, and the old invitation and privacy addresses leading to their new homes.
- **Link lifetimes:** an invitation link lasting 72 hours and a password reset link
  48; a link aged past its time showing a page that says so, with nothing to press;
  the People page showing Not accepted for a member and an organizer; New link
  reopening an invitation; and a cancelled, replaced or used link no longer working.
- **Invitations and accounts:** revoke, re-issue, expired, and replayed links; links
  surviving simulated chat previews and repeat opens until Continue is pressed;
  setup validation; routing after sign-in and sign-out; session survival across a
  token refresh; signing out one device; recovery; suspension; and user type
  changes made from a person's manage page, behind a confirmation that names them.
- **Members:** profile, photo and links, privacy switches that save as they are
  flipped, the ID button on Home, the activity page saying why a session gave no
  points, and forms keeping their values after a validation error.
- **Organizers:** a new admin setting up their profile after the authenticator,
  editing it, the public page with its Organizer badge, user type changes keeping
  the profile and card, and organizers being refused points and check-in.
- **Events:** the short form and its validation, the web address made from the
  name, the two attendance rules becoming the stored times, no time shift on save,
  publishing, cancelling and restoring, and adding and removing a bonus session.
- **Kiosk:** reading with no button, a card not being read twice until it is
  lifted, the confirm button's height, the 48-hour PSU ID rule, dismissing a
  preview, reader errors, duplicate scans, a legacy minimum stay, and check-in by
  name or by a typed QR link with the method recorded.
- **Corrections:** every attendance correction a superadmin can make.
- **Cards:** one button preparing, writing, reading back and switching a card on;
  a spoiled write leaving the old card working; a replacement; a card switched
  off; and several cards written in a row.
- **Rewards:** request, cancel, re-request, approve, hand over, and reject with a
  required reason, with the point balance checked after each step and handled
  requests staying on the page as history.
- **Permanent delete:** a normal admin not being offered it; a superadmin deleting
  an invitation with its unused account, a handled reward request, a reward, a
  card, an event with its attendance while the member's points stay, and a
  member's account with its photos and sign-in; each delete appearing in the
  audit log; and the audit log refusing a delete or an update from the service key.
- **Audit and browser:** audit entries shown as sentences and filtered by topic,
  audit contents, phone-width layout, the CSP, and uncaught page errors.

- **Readers:** a reader being set up for Bluetooth by its cable, once however often
  it is plugged in; connecting by Bluetooth and reading a card with nothing readable
  on the air; the page moving to the cable when it is plugged in; the organizer
  choosing Bluetooth with the cable in and going back; falling back when the cable
  is pulled; and a reader with the wrong key being refused.

These specs use a stand-in reader (`tests/e2e/support/fake-reader.ts`) with a fake
Web Serial port and a fake Web Bluetooth radio. It follows the firmware's rule for
when the radio is on and does the real handshake and sealing, and it returns
`no_card` on first reads to prove that the wait loops recover when a card appears.
`reader-hardware.spec.ts` runs the same journey against a physical reader and
real radio when `READER_PORT` is set; it is skipped otherwise. `admin-invitation.spec.ts`
and the public specs cover the rest. The suite skips a hosted Supabase project
unless `E2E_ALLOW_HOSTED_SUPABASE=yes`, which must never be set for production.

## Hardware coverage

Verified on a physical reader with firmware 2.1.0 on 2026-11-12 (details in
`docs/hardware-bringup.md`, section 9b):

- `firmware/kiosk-reader/tools/reader_check.py --bluetooth`, 44 of 44 checks over
  the cable and over real radio: pairing by cable only, the handshake, sealed
  commands, the wrong key, a replayed line and an unsealed line each ending the
  session, a silent caller dropped after 8 seconds, the cable taking over, the
  organizer's override, and Bluetooth switched off.
- `reader-hardware.spec.ts`: the real Cards page, real Web Bluetooth and the real
  server actions, through set-up by cable, connecting by Bluetooth, moving to the
  cable, choosing Bluetooth and going back, and falling back to Bluetooth, with no
  error shown. Only the serial port picker was stood in for.
- The same spec with a real card: the one-button writer preparing, writing,
  reading back and switching on a card over the cable; that card read over
  Bluetooth; and a second card written the same way over Bluetooth, replacing the
  first.
- Straight to the reader over Bluetooth: a card read, written, read back, and
  given its own link again.

Verified on the physical unit, firmware 2.0.2:

- The real app through the real reader and card: invitation, member setup, prepare,
  write, exact read-back, activate, the card URL resolving to the member's profile,
  check-in, check-out, and 7 points with 7 stars granted. The test replaced only
  `navigator.serial`, because its picker cannot be automated; the app's own lane
  code still sent and received every byte on COM3.
- The serial API directly: `info`, status, read, write, and read-back; malformed
  JSON, unknown commands, bad URIs, and URIs too long for the card; an overlong line
  producing one `line_too_long`.
- With the PN532 powered off, a read returning `nfc_not_ready` in about 1.5 s
  without hanging.
- The always-on kiosk, read-only and with nothing on the reader: it connected and
  polled about ten times a second for 18 seconds, with only `no_card` replies and
  no errors.

Not verified:

- The kiosk over Bluetooth. It reads cards with the same command the Cards page
  does, which was run, but the kiosk page itself was not.
- A reader powered from a charger with no cable to the computer, Chrome or Edge
  themselves over Bluetooth, and Chrome on Android.
- The real Chrome/Edge port picker, and a Web Serial session on the hosted app.
- A real card read through the always-on kiosk. The end-to-end pass above used the
  old Read button, and the reader was empty for the always-on run.
- The reader reconnecting by itself on a later visit, which depends on a real
  browser remembering the port.
- A real camera reading a real phone screen. The camera path was proved once with
  Chromium's simulated camera playing a picture of a member's QR code.
- A locked or too-small card, a card removed mid-write, a purchased card batch, and
  two lanes running together.
- A production card written for a live member.

## Reset

`pnpm db:reset` was run on the local stack: every count reached zero, all 14
migrations and the guard triggers stayed in place, no function became callable by
`anon`, and a superadmin from `pnpm db:bootstrap-admin` then set a password, enrolled
TOTP, and reached `/admin`.

A person then ran the reset and the bootstrap on production. A read-only check
afterward found only the first superadmin, with TOTP verified and an AAL2 session,
and no members, invitations, events, cards, or photos. All 14 migrations and the
guard triggers remain, and API role privileges are unchanged.

## Known gaps

- No authenticated E2E run on the hosted app, which would need test accounts on
  production.
- No axe-core/manual screen-reader audit.
- No load test or backup/restore rehearsal.
- Legacy server device/kiosk paths remain for historical data but are not part of
  the supported USB flow.
- `pnpm verify` still reports its intentionally unimplemented release gates as
  blocked. CI runs format, lint, typecheck, unit tests, and build, so the other
  commands above were run separately.
