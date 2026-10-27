# Deployment

Target: Next.js app on Vercel, Supabase Postgres/Auth/Storage, custom domain `member.gdgpsu.dev`.

The Supabase project, migrations, publishable key and admin role are configured. **Nothing in this document has been executed against Vercel or DNS.** It is the procedure and the prerequisite list, not evidence of a deployment. No production deployment exists for this build. Email is manual by design: the app never sends mail, so there is no SMTP dependency.

## 1. Prerequisites (user/operator action)

| Item | Needed for | Status |
| --- | --- | --- |
| Vercel account/project with access to the repo | Hosting | BLOCKED — not provided |
| DNS control for `gdgpsu.dev` | `member.gdgpsu.dev` | BLOCKED |
| Supabase project ownership + a publishable key | Auth/DB; see key note below | Done — key supplied and wired |
| Invitation/recovery delivery | Link delivery | Manual — an admin copies links into their own mail client; no SMTP |
| PSU IT approval for ESP32 network access | Hardware lanes | Confirmed by organizer; record the approved SSID/EAP before flashing |
| Admin bootstrap identity (real email) | First admin | Done — `gdg@psu.edu` role granted |

## 2. Environment variables (names only)

Set these in Vercel → Project → Settings → Environment Variables for **Production** and **Preview** separately. Never commit values.

| Name | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Public | Canonical origin for callbacks/links (`https://member.gdgpsu.dev`) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Public | Support address shown to members (`gdg@psu.edu`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Publishable key (`sb_publishable_…`) for the RLS-bound SSR client |
| `SUPABASE_SECRET_KEY` | **Server only** | New-format secret key; never `NEXT_PUBLIC_` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Legacy fallback if no secret key |
| `CARD_WRITE_ENCRYPTION_KEY` | **Server only** | 32-byte base64 key for AES-GCM card payloads; rotating it invalidates stored encrypted tokens |
| `DATABASE_URL` | **Server/CI only** | Direct/pooler Postgres URL for `db:migrate`/`db:verify`; not needed by the running app |
| `NODE_ENV` | Runtime | Set automatically by Next/Vercel |

The app validates these at server startup (`apps/web/src/lib/env.ts`) and fails closed if required values are missing.

### Key note (important)

`NEXT_PUBLIC_SUPABASE_ANON_KEY` holds the publishable key. `createSupabaseServer()` and the request proxy use it, so all user/anonymous queries are subject to RLS. `SUPABASE_SECRET_KEY` is used only by `createSupabaseAdmin()` for explicitly authorized admin operations (auth-admin link generation, cross-member reads, device jobs). Never expose the secret key to the browser or firmware.

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
   - Disable public signup. Accounts are created by the Admin API through generated invitation links. (The initial admin was created through signup and then confirmed; disable signup after that.)
   - Enable TOTP MFA for admin accounts. Admins without AAL2 cannot use `/admin/*` and are redirected to `/admin-mfa`.
   - **Email:** no SMTP is configured and the app sends no mail. Admin → Invitations generates a one-time link with `generateLink`; the admin copies it into their own mail client. The same applies to member recovery on the member detail page. Generated links expire per the project's **Email OTP Expiration** setting (default 1 hour); raise it to fit your sending workflow, and regenerate a link if it expires. Do not reduce this setting.
3. **Storage:** bucket `avatars` (public read, server-side uploads only). Do not create a second bucket; `photo_path` values reference this bucket.
4. **Backups:** enable plan-appropriate backups/PITR in the dashboard and record retention. See `docs/backup-restore.md`.

## 4. Admin bootstrap

There is no public admin creation path. Run `pnpm db:bootstrap-admin --email you@psu.edu --out .local/admin-link.txt`; it finds or creates the Auth user, grants the `admin` role and writes a one-time recovery link to the output file (gitignored). No email is sent and no password is printed — deliver the link privately, then delete the file. Equivalent reviewed SQL (after creating the Auth user in Supabase):

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
3. An admin-generated invitation link works once; expired/revoked link shows a neutral state.
4. Setup creates a member, `/m/<slug>` loads, leaderboard excludes private profiles.
5. `/c/<token>` redirects (307) to `/m/<slug>`; a revoked token shows `/card-unavailable`.
6. Admin routes require MFA (AAL2) and redirect to `/admin-mfa` when unenrolled; member routes reject anonymous requests.
7. Security headers present; no secret appears in the HTML/JS bundle.
8. Device API rejects unknown/disabled devices and oversized payloads (`/api/device/v1/heartbeat` without valid credentials returns 401).

## 7. Rollback and recovery

- **App:** Vercel → Deployments → promote the last known-good deployment. Environment variable changes require a redeploy.
- **Database:** migrations are forward-only and there are no down migrations. For a bad migration, stop deploys, restore the pre-migration dump into a disposable project to investigate, then write a corrective migration. Do not delete ledger/attendance rows.
- **Secrets:** if a Supabase secret key or device secret is exposed, rotate in Supabase/Vercel, redeploy, disable affected devices, and review `audit_log`.
- **Domain/links:** reverting DNS changes auth callbacks; generated invitation/recovery links are one-time, so reissue them after a domain change.

## 8. Exact blockers to resolve before production

1. Authorize creating the Vercel project and setting the production environment variables (the publishable key is supplied).
2. Approve DNS changes for `member.gdgpsu.dev` and add `https://member.gdgpsu.dev/auth/callback` to the Supabase redirect allowlist.
3. Have `gdg@psu.edu` sign in, change the bootstrap password, and enroll TOTP before any member data is entered.
4. Record PSU IT's approved ESP32 SSID/EAP method and hardware test window; do not use personal credentials or bypass TLS.
5. Confirm whether preview deployments may use a staging Supabase project (recommended) or must stay offline.

## 9. Database branching for pull requests (not configured)

The Supabase project is `potjjlmgnrqxseeendmx`. Preview database branching follows [Supabase: Branching with GitHub integration](https://supabase.com/docs/guides/deployment/branching/github-integration) and is **not enabled**: it needs a human to install the Supabase GitHub app and authorize the organization, which the database password/API keys alone cannot do.

To enable it:

1. In the Supabase dashboard, open the project → **Branching** → connect GitHub and install the Supabase integration for `GDG-PSU/members`.
2. Choose `main` as the production branch and enable a preview branch per pull request (or per selected branch).
3. Apply `supabase/migrations/*.sql` to each branch (the integration can run migrations, or the CI job can call `supabase db push` against `SUPABASE_DB_URL`).
4. Add the branch's API URL and keys to the Vercel Preview environment; never reuse the production `SUPABASE_SECRET_KEY` in previews.
5. Seed preview branches only with fictional data (`SEED_CONFIRM=yes SEED_ALLOWED=1 pnpm db:seed`).

Without branching, keep Vercel previews read-only against a dedicated staging project; do not point them at production member data.
