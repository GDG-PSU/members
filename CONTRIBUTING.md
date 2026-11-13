# Contributing

## Setup

```bash
pnpm install
cp .env.example apps/web/.env.local   # read by the web app; never commit it
cp .env.example .env.local            # read by the scripts; never commit it
pnpm dlx supabase@2.122.0 start  # local Supabase with migrations; copy its URLs and keys into both
pnpm dev                     # http://localhost:3000
```

`AGENTS.md` is the full working manual: architecture, invariants, commands and
gotchas. Read it before a change of any size.

Tests and checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm db:verify
pnpm build
```

`pnpm db:verify` mostly runs inside a transaction that is rolled back, but its concurrency checks create and remove temporary users and a reward. It refuses a non-local database unless `DB_VERIFY_ALLOW_HOSTED=yes`. Use that only for staging, never production.

## Working rules

- **Secrets never enter Git.** `.env*` (except `.env.example`), keys, card links, one-time links, reader keys and real member data stay out of commits, screenshots, logs and test fixtures.
- **Schema changes go through a new migration** in `supabase/migrations/`. Do not edit the hosted database by hand. Keep functions `SECURITY DEFINER` with `search_path = ''`, schema-qualified, and granted to `service_role` only.
- **Respect the trust boundaries.** No client-side admin checks, no client-supplied member IDs for self-service, no points or attendance writes from the browser, no attendance on a card read alone, no NFC UID as a credential, and no reader key left where a browser keeps it.
- **Ledger is append-only.** Corrections are compensating entries with a reason; never update or delete financial-style history.
- **Public responses use explicit allowlists.** Never serialize a full database row or Auth user into a public response. Add visibility tests when changing a projection.
- **Firmware:** compile no secret in, and put no Supabase key on a reader. Use bounded operations, bump the firmware version with every change, and keep the firmware, the website, the Python tools and the test stand-in agreeing on the protocol (`docs/usb-api.md`). Do not claim a hardware pass without hardware.
- **Tests:** add or update the smallest relevant test. Do not skip tests, weaken assertions or add lint/type suppressions to make a check pass. Report checks you could not run.
- **UI:** compose the shared theme/primitives in `packages/ui`; do not introduce a second component kit or one-off styling that breaks consistency. Support light/dark/system color schemes and WCAG 2.2 AA contrast.

## Commits and review

- Small, coherent commits with descriptive messages in the imperative mood.
- **No AI attribution, `Co-authored-by` trailers or generated-by footers.** Do not impersonate a human author; use the configured Git identity.
- Keep unrelated formatting out of functional commits.
- A change touching auth, RLS, ledger functions, attendance transitions, card handling or reader sessions needs a reviewer who understands the threat model and a corresponding `db-verify`, unit or E2E update.
- Do not commit generated build output, `.next`, coverage or Playwright artifacts.

## Reporting security issues

See `SECURITY.md`. Email `gdg@psu.edu`; do not open a public issue with exploit details or member data.
