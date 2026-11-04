# Test plan and results

## Verified on 2026-11-04

Environment: a production build (`next start`) on `http://localhost:3100` against
a local Supabase stack with every migration applied, plus one physical ESP32 +
PN532 on COM3 with a writable NTAG215. Nothing here ran against production.

| Check               | Command                       | Result                                         |
| ------------------- | ----------------------------- | ---------------------------------------------- |
| Formatting          | `pnpm format:check`           | Pass                                           |
| Lint / types        | `pnpm lint`, `pnpm typecheck` | Pass                                           |
| Unit tests          | `pnpm test`                   | 54/54 pass                                     |
| Production build    | `pnpm build`                  | Pass                                           |
| Browser E2E         | `pnpm e2e`                    | 51 pass, 31 skipped; 41/41 on desktop Chromium |
| Database/RLS/ledger | `pnpm db:verify`              | 76/76 pass on the local Supabase stack         |
| Firmware compile    | `pio run`                     | Pass; firmware 2.0.2                           |
| Physical reader     | USB JSON API on COM3          | 17/17 robustness checks on 2.0.2               |
| Physical end to end | Browser app + real reader     | Pass on 2.0.2; see Hardware coverage           |
| Reset and bootstrap | `pnpm db:reset`               | Pass on the local stack only; see Reset        |

The 31 skips are the signed-in specs on the mobile project, which run on desktop
only. On mobile, the 10 public specs pass, and one desktop test checks that member
and admin pages fit a phone-width viewport.

## What the browser suite covers

`tests/e2e/workflows.spec.ts` drives every workflow through the real UI, using
disposable accounts it creates and removes:

- **Access:** public sign-up refused, API keys refused on privileged functions,
  staff sign-in with TOTP, returning TOTP, HttpOnly cookies, cross-site session
  posts refused, normal-admin limits, and the login rate limit.
- **Invitations and accounts:** revoke, re-issue, expired, and replayed links; links
  surviving simulated chat previews and repeat opens until Continue is pressed;
  setup validation; routing after sign-in and sign-out; session survival across a
  token refresh; signing out one device; recovery; suspension; user type changes.
- **Members:** profile, photo and links, privacy settings, and forms keeping their
  values after a validation error.
- **Events and attendance:** event validation, no time shift on save, publishing,
  bonus sessions, the 48-hour PSU ID rule, dismissing a preview, reader errors,
  duplicate scans, minimum duration, cancelled events, and corrections.
- **Cards:** pending, active, replacement and revoked cards, and batches of cards.
- **Rewards:** request, cancel, re-request, approve, fulfil, and reject, with the
  point balance checked after each step.
- **Audit and browser:** audit contents, phone-width layout, the CSP, and uncaught
  page errors.

These specs use a fake Web Serial port, which also returns `no_card` on first reads
to prove that the wait loops recover when a card appears. `admin-invitation.spec.ts`
and the public specs cover the rest. The suite skips a hosted Supabase project
unless `E2E_ALLOW_HOSTED_SUPABASE=yes`, which must never be set for production.

## Hardware coverage

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

Not verified:

- The real Chrome/Edge port picker, and a Web Serial session on the hosted app.
- An empty antenna on real hardware. The card stayed on the reader, so `no_card` is
  covered only by the fake port.
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
