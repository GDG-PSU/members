# Deployment

Target: Next.js app on Vercel, Supabase Postgres/Auth/Storage, custom domain `member.gdgpsu.dev`.

**Nothing in this document has been executed against Vercel, DNS or production SMTP.** It is the procedure and the prerequisite list, not evidence of a deployment. No production deployment exists for this build.

## 1. Prerequisites (user/operator action)

| Item | Needed for | Status |
| --- | --- | --- |
| Vercel account/project with access to the repo | Hosting | BLOCKED — not provided |
| DNS control for `gdgpsu.dev` | `member.gdgpsu.dev` | BLOCKED |
| Supabase project ownership + a publishable key | Auth/DB; see key note below | Project exists; publishable key not supplied |
| Transactional email provider (SMTP) with SPF/DKIM/DMARC | Invitations, recovery, card-ready notices | BLOCKED |
| PSU IT approval for ESP32 network access | Hardware lanes | BLOCKED |
| Admin bootstrap identity (real email) | First admin | BLOCKED — do not invent one |

## 2. Environment variables (names only)

Set these in Vercel → Project → Settings → Environment Variables for **Production** and **Preview** separately. Never commit values.

| Name | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Public | Canonical origin for callbacks/links (`https://member.gdgpsu.dev`) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Public | Support address shown to members (`gdg@psu.edu`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Publishable/anon key — currently empty; see note |
| `SUPABASE_SECRET_KEY` | **Server only** | New-format secret key; never `NEXT_PUBLIC_` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Legacy fallback if no secret key |
| `CARD_WRITE_ENCRYPTION_KEY` | **Server only** | 32-byte base64 key for AES-GCM card payloads; rotating it invalidates stored encrypted tokens |
| `DATABASE_URL` | **Server/CI only** | Direct/pooler Postgres URL for `db:migrate`/`db:verify`; not needed by the running app |
| `NODE_ENV` | Runtime | Set automatically by Next/Vercel |

The app validates these at server startup (`apps/web/src/lib/env.ts`) and fails closed if required values are missing.

### Key note (important)

The supplied project has a server-side secret key but no publishable key. The app therefore runs Supabase SSR with the secret key on the server only. This works, but it means the web tier can bypass RLS. **Recommended hardening:** create a publishable key in Supabase and set `NEXT_PUBLIC_SUPABASE_ANON_KEY`, then switch `createSupabaseServer()` to prefer the publishable key. Keep the secret key for admin-only operations. Do not expose the secret key to the browser to work around the missing key.

## 3. Supabase configuration

1. **Apply migrations** from the repository (never hand-edit the hosted schema):
   ```bash
   supabase link --project-ref <project-ref>
   supabase db push
   # or, without the CLI:
   DATABASE_URL="postgresql://…pooler…" pnpm db:migrate
   ```
   Migration `0003_rls.sql` creates the public `avatars` bucket with a 2 MB limit and JPEG/PNG/WebP MIME allowlist. Verify it exists after the first deploy.
2. **Auth settings:**
   - Site URL: `https://member.gdgpsu.dev`
   - Additional redirect URLs: `https://member.gdgpsu.dev/auth/callback`, `http://localhost:3000/auth/callback` (local only). Add preview origins only if previews need sign-in.
   - Disable public signup. Accounts are created by invitation through the Admin API.
   - Enable TOTP MFA for admin accounts. The app's `/admin-mfa` gate is pending implementation at time of writing; once present, admins without AAL2 cannot use admin routes.
   - Configure a production SMTP provider and branded invitation/recovery templates. The built-in sender is rate-limited and unsuitable for an invitation drive.
3. **Storage:** bucket `avatars` (public read, server-side uploads only). Do not create a second bucket; `photo_path` values reference this bucket.
4. **Backups:** enable plan-appropriate backups/PITR in the dashboard and record retention. See `docs/backup-restore.md`.

## 4. Admin bootstrap

There is no public admin creation path. Run `pnpm db:bootstrap-admin --email you@psu.edu`; it finds or creates the Auth user, grants the `admin` role and requests a recovery email. No password is printed. Equivalent reviewed SQL (after creating the Auth user in Supabase):

```sql
insert into public.user_roles (auth_user_id, role, note)
select id, 'admin', 'initial bootstrap'
from auth.users
where lower(email) = lower('REPLACE_WITH_REAL_ADMIN_EMAIL')
on conflict (auth_user_id, role) do update set revoked_at = null;
```

Then sign in and enroll TOTP. Do not put the admin's email or credentials in this repository.

## 5. Vercel

- Import the repository as a monorepo project.
- Root directory: repository root (`./`).
- Install command: `pnpm install --frozen-lockfile`.
- Build command: `pnpm --filter @gdg/web build` (or `pnpm build`, which runs Turborepo). The app uses `transpilePackages` for `@gdg/ui` and `@gdg/contracts`, so no separate package build is required.
- Node version: 20.9+ (Node 24 used locally).
- Add the environment variables above for Production and Preview. Preview must not point at the production database or use production member data.
- Add the custom domain `member.gdgpsu.dev` only after DNS authorization. Enable HSTS at the domain level once HTTPS is confirmed.
- Function duration/region: default is fine; requests are short and use the Postgres pooler. Do not add a persistent server.

## 6. Post-deploy verification

1. `GET /` renders (200) and no CSP/console errors.
2. Sign-in flow works on the real origin; cookies are Secure/HttpOnly; callback redirects to `/invite/accept`.
3. A test invitation email arrives; link works once; expired/revoked link shows a neutral state.
4. Setup creates a member, `/m/<slug>` loads, leaderboard excludes private profiles.
5. `/c/<token>` redirects (307) to `/m/<slug>`; a revoked token shows `/card-unavailable`.
6. Admin routes require MFA (once implemented); member routes reject anonymous requests.
7. Security headers present; no secret appears in the HTML/JS bundle.
8. Device API rejects unknown/disabled devices and oversized payloads (once implemented).

## 7. Rollback and recovery

- **App:** Vercel → Deployments → promote the last known-good deployment. Environment variable changes require a redeploy.
- **Database:** migrations are forward-only and there are no down migrations. For a bad migration, stop deploys, restore the pre-migration dump into a disposable project to investigate, then write a corrective migration. Do not delete ledger/attendance rows.
- **Secrets:** if a Supabase secret key or device secret is exposed, rotate in Supabase/Vercel, redeploy, disable affected devices, and review `audit_log`.
- **Domain/email:** reverting DNS or SMTP affects all auth links; coordinate with the organizers before changing.

## 8. Exact blockers to resolve before production

1. Provide a Vercel project (or authorize creating one) and a Supabase publishable key.
2. Approve the production origin and add `https://member.gdgpsu.dev/auth/callback` to the Supabase redirect allowlist.
3. Provide/authorize a transactional email provider and sender domain.
4. Approve DNS changes for `member.gdgpsu.dev`.
5. Provide the real admin email for role bootstrap and require TOTP enrollment.
6. Confirm PSU IT's approved ESP32 network method; do not use personal credentials or bypass TLS.
7. Decide whether production admin MFA is mandatory before any member data is entered (recommended: yes).
