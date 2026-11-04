# Test plan and results

## Verified on 2026-11-04

Environment: production build (`next start`) on `http://localhost:3000`, hosted
Supabase project, real PN532 on COM3 with a writable NTAG215. No test fixture is
left behind; the production reset removes any residue.

| Check               | Command                         | Result                                                              |
| ------------------- | ------------------------------- | ------------------------------------------------------------------- |
| Formatting          | `pnpm format:check`             | Pass after formatting the changed files                             |
| Lint / types        | `pnpm lint`, `pnpm typecheck`   | Pass                                                                |
| Unit tests          | `pnpm test`                     | 33/33 pass                                                          |
| Production build    | `pnpm build`                    | Pass; all routes including `/admin/cards` compile                   |
| Browser E2E         | `pnpm e2e`                      | 20 pass, 2 intentionally skipped mobile admin specs                 |
| Database/RLS/ledger | `pnpm db:verify`                | 46/46 pass against hosted Supabase                                  |
| Firmware compile    | `pio run`                       | Pass; 304,521 bytes flash (23.2%), 23,552 bytes RAM (7.2%)          |
| Physical NFC        | USB JSON API on COM3            | Read pass on 2.0.1 after full power-cycle; write/read-back on 2.0.0 |
| Route smoke         | `curl` against production build | Public pages 200; `/admin` and `/admin/cards` redirect to `/login`  |

The authenticated E2E suite now includes: disposable admin sign-in and TOTP,
invitation creation, member setup, privacy/photo checks, USB card preparation,
URL shape/origin checks, activation, and database status `active` with an
issuance timestamp. It verifies that a normal admin cannot see Users/Audit, cannot
open their routes, and is not offered staff invitations. A separate disposable
superadmin verifies the Users page, staff-role selector and full Audit access.
The suite also uses a fake Web Serial port to read that active card at
`/admin/kiosk`, confirm check-in and check-out, and assert the attendance state
and reward in the database. The fake port returns `no_card` on the first read of
each flow and on the writer's first write, proving the open-ended wait loops
recover when a card appears. It also asserts that no attendance exists before the
organizer confirms the kiosk preview. The shared wait helper is unit-tested to
keep retrying past ten seconds, surface other reader errors immediately, and stop
when cancelled. The fixture event, member, admin and superadmin are removed
afterward through the audited erasure path.

## Hardware coverage

Verified on the physical unit:

- PN532 detected over SPI; firmware reports `nfcReady: true`.
- NTAG215 read and write operations; exact read-back verification.
- Card write of a valid NDEF URI and independent read-back.
- Firmware `info` shows `deviceId: esp32-3c1c6cc92df4`, protocol 2 and
  `transport: usb-serial`.
- No WiFi or `mode` key is exposed; the old `mode` command returns
  `unknown_cmd`.

Not verified by the agent:

- A real Chrome/Edge Web Serial session against the hosted admin page. The
  page requires an admin/MFA session and a human serial-port selection.
- A complete firmware 2.0.1 write/read-back run. The read path is confirmed on
  hardware after a full power-cycle; write behavior is unchanged from 2.0.0.
- The final hosted-URI rewrite attempt returned `no_card` because no NTAG was on
  the antenna at the time; the earlier read/write/read-back test passed.
- A card written for a live member with a real active `/c/` token.
- Full TOTP sign-in on the hosted origin after the reset.
- Vercel deployment completion after the push.

## Known gaps

- No axe-core/manual screen-reader audit.
- No load test or backup/restore rehearsal.
- Legacy server device/kiosk paths remain for historical data but are not part
  of the supported USB flow.
- pnpm verify still reports its intentionally unimplemented release gates as
  blocked; CI runs format/lint/typecheck/unit/build, and the commands above were
  run separately.
