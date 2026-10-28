# Test plan and results

## Local verification, 2026-10-28

The hosted Supabase project could not be inspected by the connected account (HTTP 403). The results below use disposable local Supabase, not production data. Administrators send invitation and recovery links manually; no real mail was sent.

| Check                 | Command                                                                                                                                                                                                                | Result                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Dependency install    | `pnpm install --frozen-lockfile`                                                                                                                                                                                       | Pass                                                                                                     |
| Local migrations      | `pnpm dlx supabase@2.122.0 start` and `pnpm dlx supabase@2.122.0 migration up --local`                                                                                                                                 | Migrations 0001–0008 applied locally; initial start command timed out while services were still starting |
| Database checks       | `DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres pnpm db:verify`                                                                                                                                  | 43 assertions passed: ledger, concurrency, attendance, privacy, RLS and MFA                              |
| Lint / types / units  | `pnpm lint`, `pnpm typecheck`, `pnpm test`                                                                                                                                                                             | Pass; 25 unit tests                                                                                      |
| Production build      | `pnpm build`                                                                                                                                                                                                           | Pass                                                                                                     |
| Public browser tests  | `pnpm e2e`                                                                                                                                                                                                             | 16 passed; two invitation instances skipped because test origin differed from the configured site origin |
| Focused browser tests | `pnpm exec playwright test tests/e2e/device-security.spec.ts tests/e2e/admin-invitation.spec.ts --project=desktop-chromium`                                                                                            | 2 passed against local Supabase, with local environment variables and dev server configured              |
| Firmware parser       | `g++ -std=c++17 -Wall -Wextra -Werror -I firmware/kiosk-reader/lib/ndef_url firmware/kiosk-reader/test/host/test_ndef_url.cpp firmware/kiosk-reader/lib/ndef_url/ndef_url.cpp -o .local/ndef_test && .local/ndef_test` | Pass                                                                                                     |
| Firmware compile      | `pio run -d firmware/kiosk-reader`                                                                                                                                                                                     | Pass for `esp32dev`, using example-only credentials; no board was flashed                                |
| Dependency audit      | `pnpm audit`                                                                                                                                                                                                           | No known vulnerabilities reported                                                                        |
| Formatting            | `pnpm format:check`                                                                                                                                                                                                    | Fails on existing repository-wide formatting differences and changed files; not a release pass           |

Run `pnpm verify` to attempt available release checks. It reports missing prerequisites and unimplemented release gates as failures rather than treating them as passes. Use a disposable local/staging database; `db:verify` creates and removes a concurrency fixture. Browser tests require a running app, local Supabase keys, `E2E_BASE_URL`, and the same `CARD_WRITE_ENCRYPTION_KEY` as the app. `pio` requires PlatformIO and the ignored firmware configuration.

## Not yet verified or incomplete

- Full pgTAP grant/policy matrix; API security and complete member/admin/kiosk/reward browser journeys.
- Shared firmware/server HMAC vector executed on the firmware target, device clock/network recovery, offline persistence, and two physical lanes.
- WCAG/axe audit and visual review at all requested breakpoints.
- Comprehensive secret scan, backup/restore rehearsal, and production configuration, DNS, Vercel or email delivery.
- Physical ESP32, PN532, NFC tags, actual PSU network authorization and TLS trust.

`pnpm verify` must remain nonzero until the missing release gates are implemented and pass. Static NFC tags can be cloned and never authorize points or attendance without staff confirmation.
