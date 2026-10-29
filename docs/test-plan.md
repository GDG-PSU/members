# Test plan and results

## Verified against the hosted project, 2026-10-29

The project `potjjlmgnrqxseeendmx` has all ten migrations recorded in `supabase_migrations.schema_migrations` and a private `avatars` bucket. Test fixtures are erased after each run; only real accounts remain: two activated administrators (`sainaman@psu.edu`, `gdg@psu.edu`) and one member. No real email is sent; administrators copy and deliver links themselves.

| Check                | Command                                                                                          | Result                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting           | `pnpm format:check`                                                                              | Pass                                                                                                                                                                                                                             |
| Lint / types / units | `pnpm lint`, `pnpm typecheck`, `pnpm test`                                                       | Pass; 29 unit tests                                                                                                                                                                                                              |
| Production build     | `pnpm build`                                                                                     | Pass                                                                                                                                                                                                                             |
| Database checks      | `pnpm db:verify`                                                                                 | 46 assertions passed: ledger, concurrency, attendance, privacy, RLS, MFA, erasure and private bucket                                                                                                                             |
| Browser tests        | `pnpm e2e`                                                                                       | 19 passed, 1 skipped (the mobile admin spec skips by design)                                                                                                                                                                     |
| Full-surface run     | `.local/full-test.mjs` (manual harness, not committed)                                           | 34/34: every admin page, member and admin invitations, password setup, TOTP gate, points, events, cards, kiosk confirmation including the 48h photo-change PSU ID gate, rewards, suspension, privacy, devices, audit and cleanup |
| Recovery password    | Disposable user followed a `/auth/confirm` recovery link, set a password, then signed in with it | Pass                                                                                                                                                                                                                             |
| Firmware parser      | `g++ ... test_ndef_url.cpp ... && .local/ndef_test`                                              | Pass                                                                                                                                                                                                                             |
| Dependency audit     | `pnpm audit`                                                                                     | No known vulnerabilities reported                                                                                                                                                                                                |

Generated invite and recovery links now confirm at `/auth/confirm` on the app's own origin. This removes the previous dependency on Supabase's redirect allowlist, which rewrote custom-domain links to the project's Site URL (localhost during this run). `NEXT_PUBLIC_SITE_URL` must still be the final public origin when new links are generated.

Run `pnpm verify` to attempt available release checks. It reports missing prerequisites and unimplemented release gates as failures rather than treating them as passes. Use a disposable local/staging database; `db:verify` commits temporary fixtures and removes them through `erase_member`. Browser tests require a running app, Supabase keys, `E2E_BASE_URL`, and the same `CARD_WRITE_ENCRYPTION_KEY` as the app.

## Not yet verified or incomplete

- axe-core/WCAG automation and manual screen-reader review; responsive screenshots at every requested breakpoint.
- pgTAP policy/grant matrix (the equivalent 46-assertion `db:verify` suite passes).
- A shared firmware/server HMAC signature vector executed on the firmware target, plus physical ESP32/PN532/tag and PSU network validation.
- Comprehensive secret scanning and a backup/restore rehearsal.
- Vercel production deploy, DNS for `member.gdgpsu.dev`, and the final Supabase Email OTP expiry decision.
- Administrator sign-in: password plus TOTP at `/admin-mfa` (verified for both admins locally; repeat on the production origin after deploy).

Static NFC tags can be cloned and never authorize points or attendance without staff confirmation.
