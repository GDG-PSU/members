# Contributing

## Setup

```bash
pnpm install
cp .env.example .env.local   # fill in values; never commit it
pnpm db:migrate              # or: supabase db push
pnpm dev                     # http://localhost:3000
```

Tests and checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm db:verify
pnpm build
```

`pnpm db:verify` runs inside a transaction that is rolled back, but it does create and remove a concurrency-test user/reward. Run it against local/staging Supabase, not production, unless you accept temporary rows.

## Working rules

- **Secrets never enter Git.** `.env*` (except `.env.example`), firmware `secrets.h`, keys, card tokens and real member data stay out of commits, screenshots, logs and test fixtures.
- **Schema changes go through a new migration** in `supabase/migrations/`. Do not edit the hosted database by hand. Keep functions `SECURITY DEFINER` with `search_path = ''`, schema-qualified, and granted to `service_role` only.
- **Respect the trust boundaries.** No client-side admin checks, no client-supplied member IDs for self-service, no points/attendance writes from the browser, no attendance on scan alone, no NFC UID as a credential, no disabling TLS validation.
- **Ledger is append-only.** Corrections are compensating entries with a reason; never update or delete financial-style history.
- **Public responses use explicit allowlists.** Never serialize a full database row or Auth user into a public response. Add visibility tests when changing a projection.
- **Firmware:** never hard-code personal credentials or Supabase keys. Keep the parser/state machine host-testable, use bounded operations and backoff, and document hardware assumptions. Do not claim a hardware pass without hardware.
- **Tests:** add or update the smallest relevant test. Do not skip tests, weaken assertions or add lint/type suppressions to make a check pass. Report checks you could not run.
- **UI:** compose the shared theme/primitives in `packages/ui`; do not introduce a second component kit or one-off styling that breaks consistency. Support light/dark/system color schemes and WCAG 2.2 AA contrast.

## Commits and review

- Small, coherent commits with descriptive messages in the imperative mood.
- **No AI attribution, `Co-authored-by` trailers or generated-by footers.** Do not impersonate a human author; use the configured Git identity.
- Keep unrelated formatting out of functional commits.
- A change touching auth, RLS, ledger functions, attendance transitions, card handling or device auth needs a reviewer who understands the threat model and a corresponding `db-verify`/unit/E2E update.
- Do not commit generated build output, `.next`, coverage or Playwright artifacts.

## Reporting security issues

See `SECURITY.md`. Email `gdg@psu.edu`; do not open a public issue with exploit details or member data.
