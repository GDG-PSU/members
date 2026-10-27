# ADR 0001 — Stack and trust boundaries

- Status: Accepted
- Date: 2026-10-27

## Context

GDG@PSU needs a member identity portal, a privacy-aware public profile and leaderboard, an auditable points/stars economy, event attendance confirmed by humans, a rewards catalogue, and two ESP32/PN532 lanes that can read member cards and write new ones. The organization has a Supabase project and intends to host on Vercel. The system handles PII and loyalty value, so auditability and least privilege matter more than feature velocity.

## Decision

1. **Next.js App Router on Vercel** for UI and server actions/route handlers. Server Components handle read-heavy pages; route handlers serve device and auth callbacks. Node runtime is used where image processing/database administration is needed.
2. **pnpm workspace + Turborepo**, with `apps/web`, `packages/ui` (MUI theme/primitives), `packages/contracts` (Zod schemas/types) and an independent PlatformIO firmware project. Shared packages are source-transpiled by Next (`transpilePackages`), avoiding a separate build step for pure TS.
3. **Supabase Postgres/Auth/Storage** as the system of record. Auth invitations/recovery are Supabase-managed; the database stores no passwords. Migrations are SQL files and the only schema source of truth.
4. **Ledger-derived balances with immutable entries.** Points/stars are append-only ledgers; balances are sums. All value-changing operations are transactional SQL functions (`SECURITY DEFINER`, empty `search_path`, `service_role`-only) that enforce idempotency, inventory and non-negative balances under row locks.
5. **Server-authoritative authorization.** No member write policies on sensitive tables. The web server authenticates the actor, checks the current role from `user_roles`, and only then uses the service role. Public reads use explicit projection views.
6. **Attendance requires a human admin.** Device scans create pending rows only. `confirm_scan` performs check-in/check-out and reward granting in one transaction, gated by session windows, a duration threshold, and uniqueness.
7. **Cards are routing tokens, not authentication.** A 256-bit token is stored as a SHA-256 hash for lookup plus an AES-GCM encrypted copy for the owner's authenticated digital ID and one-time write jobs. Device UIDs are never credentials. Write jobs are short-lived, device-bound, single-use, and require read-back verification.
8. **Device identity is separate from user identity.** Devices use a public ID plus a high-entropy secret with only a verifier stored server-side. Firmware talks only to a narrow HTTPS middleware API, never to Supabase, and never disables certificate validation.
9. **Polling instead of realtime processes.** Kiosk/device updates use short polling; all authoritative state is in Postgres. This avoids custom servers and in-memory locks on serverless infrastructure.
10. **MUI v9 as the only component system**, with one central theme supporting light/dark/system color schemes, and branded primitives shared through `packages/ui`.

## Alternatives rejected

- **Firebase/Firestore:** weaker relational constraints and transactional guarantees for a double-entry-style ledger; no SQL RLS; would fragment auth/database/storage choices.
- **Custom auth or password storage:** unnecessary risk; Supabase Auth provides invitation/recovery/MFA flows and session handling.
- **Direct PostgREST writes from the browser for points/attendance:** impossible to make atomic and idempotent without exposing privileged functions; would weaken RLS boundaries.
- **Mutable balance columns:** simple to read but loses auditability and invites drift; rejected in favor of derived balances.
- **A long-running Node/Bun server for kiosk realtime:** incompatible with Vercel's serverless model and adds operational burden; polling is sufficient at event scale.
- **NFC UID as the credential:** copyable/emulatable on some hardware and not an authorization factor; rejected.
- **Client-side-only admin gating or role-from-email:** trivially bypassed; roles live in `user_roles` and are checked server-side.
- **A second UI kit or utility-CSS design system:** would fragment visual language and accessibility behavior.

## Consequences

- Positive: strong audit trail, testable invariants, database-enforced isolation, one deployable web app, minimal infrastructure.
- Negative: more SQL surface to maintain; every new value operation needs a transactional function and tests. Server actions plus a privileged key mean the web server must remain uncompromised for admin operations. Update (2026-10-27): a publishable key is now wired into the cookie-bound SSR client; the secret key is limited to admin-only call sites.
- Operational: migrations must be applied intentionally; device secrets/card recovery require admin runbooks; no offline attendance is permitted by design.
- Device work remains hardware-dependent: the API/firmware contract is defined, but physical read/write, campus networking and two-lane concurrency still require hardware and PSU IT approval.
