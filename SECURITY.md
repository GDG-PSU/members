# Security policy

## Reporting a vulnerability

Email **gdg@psu.edu** with a description, reproduction steps and impact. Do not open a public issue for a suspected vulnerability, and do not include other members' data or live credentials in the report.

This is a student-run project with no formal SLA. Organizers will acknowledge reports as soon as practical and coordinate a fix before public disclosure.

## Supported versions

Only the current `main` branch is supported. There are no maintained release branches.

## Security model in brief

- **Identity:** Supabase Auth (email + password, invitation-only accounts, admin-initiated recovery). No public signup. Passwords are never stored by this application.
- **Authorization:** server-side checks on every member/admin page, server action and route handler. Roles come from `user_roles`, never from editable metadata or email suffixes. Member data is additionally protected by Postgres RLS.
- **Value integrity:** points/stars are append-only ledgers; balances are sums. Grants, reversals and redemptions run in transactional SQL functions restricted to the server role, with idempotency keys, row locks and non-negative balance checks.
- **Attendance:** device scans only create pending rows. A human admin must confirm check-in and check-out; rewards require a server-computed duration threshold.
- **Cards:** NFC cards store a single opaque HTTPS URL. Card tokens are hashed at rest (SHA-256); an AES-256-GCM encrypted copy exists only for the owner's authenticated digital ID and one-time write jobs. Card possession never authorizes attendance, spending or account access.
- **Devices:** separate identity from users. Per-device high-entropy secret, only a hash stored, rotatable/revocable, scoped endpoints, TLS required. Firmware never receives Supabase keys.
- **Public data:** explicit allowlisted projection views; email private by default; internal UUIDs, card data and admin notes never public.
- **Auditing:** append-only audit and attendance-audit tables with actor, reason and redacted before/after values.
- **Secrets:** server-only Supabase secret/service key, encryption key and database URL live in ignored env files (Vercel env in deployment). `.env.example` contains placeholders only. Firmware secrets are ignored; only `secrets.example.h` belongs in Git.
- **Headers:** CSP, `X-Content-Type-Options`, `Referrer-Policy`, framing denial and a permissions policy are configured in `apps/web/next.config.ts`. HSTS must be enabled at the edge/production host.

## Secret handling rules

1. Never commit `.env*`, firmware `secrets.h`, service keys, card tokens, invitation/recovery URLs or production member data.
2. Never prefix a secret with `NEXT_PUBLIC_`.
3. Never put Supabase credentials on an ESP32.
4. Rotate a device secret immediately if it is suspected lost; disable the device first.
5. Do not paste secrets into chats, issues, screenshots or test reports.
6. Do not disable TLS certificate validation in firmware.

## Known limitations (not a clean bill of health)

- The SSR client uses the publishable key, so user/anonymous queries are bound by RLS. A server compromise can still reach the secret key used for admin operations (auth-admin link generation, cross-member reads, device jobs).
- Invitations and recovery are delivered manually: an admin copies a one-time Supabase link into their own mail client. The link is as sensitive as a password until used and expires per the project's Auth OTP setting.
- The device middleware API is auth-tested, but the firmware build and hardware behavior are not verified in this environment.
- No production deployment, custom domain, dependency audit, secret scan or backup/restore drill has been completed.
- Authenticated admin/member E2E, accessibility and load tests have not been run; admin TOTP enrollment is still pending.

See `docs/threat-model.md` for the threat table and the ASVS mapping with tested/untested controls, and `docs/test-plan.md` for exact recorded results.
