# Backup and restore

## Principles

- The database is the source of truth for identity, attendance, ledger and audit history. Storage holds profile photos.
- **Never restore by deleting or rewriting ledger rows.** If data is wrong, restore to a disposable environment, reconcile, and apply an audited compensating entry in production.
- Test restores against a disposable Supabase project, never over the live one.
- Supabase plan-level backups/PITR are not configured by this repository. Enable them in the Supabase dashboard according to the plan the organization buys, and record the retention window.

## Logical backup (schema + data)

Use the direct/pooler connection string from `DATABASE_URL`. Do not paste it into shell history on a shared machine; prefer an env var.

```bash
# Roles/schema/data, compressed custom format
pg_dump --no-owner --no-privileges --format=custom \
  --file="gdgpsu-$(date +%Y%m%d-%H%M).dump" "$DATABASE_URL"

# Human-readable schema snapshot for review
pg_dump --schema-only --no-owner --no-privileges \
  --file="gdgpsu-schema-$(date +%Y%m%d).sql" "$DATABASE_URL"
```

Notes:

- `pg_dump` must be new enough for the server version (Supabase currently uses Postgres 15+; install a matching client).
- The dump includes `auth` schema data only if the role has access. Supabase Auth users may need to be exported separately (Dashboard → Authentication, or `supabase auth` tooling) depending on plan/permissions.
- Store dumps encrypted, outside the repository, with access limited to organizers.

## Restore drill

1. Create a disposable Supabase project (never restore over production).
2. Apply migrations from zero to validate the schema path:
   ```bash
   DATABASE_URL="postgresql://...disposable..." pnpm db:migrate
   ```
3. Restore the custom dump:
   ```bash
   pg_restore --no-owner --no-privileges --clean --if-exists \
     --dbname="$RESTORE_DATABASE_URL" gdgpsu-YYYYMMDD-HHMM.dump
   ```
4. Verify invariants:
   ```sql
   select count(*) from public.members;
   select count(*) from public.point_ledger;
   select count(*) from public.star_ledger;
   select member_id, sum(delta) as points from public.point_ledger group by member_id order by points asc limit 10;
   select count(*) from public.attendance_records where state = 'completed' and qualified and ledger_id is null;
   ```
   The last query should normally return 0. Investigate any row rather than deleting it.
5. Start the app against the restored project with a non-production env file, sign in with a test account, and check a public profile, leaderboard, member dashboard and one card redirect.
6. Record the drill date, dump size, restore duration and any warnings. Destroy the disposable project when finished.

A completed restore drill is **not recorded** for this build. This document is a procedure, not evidence.

## Storage (profile photos)

- The `avatars` bucket is public with random object paths; it is not included in a database dump.
- Back up objects with the Supabase Storage API/CLI or `rclone` configured for the S3-compatible endpoint. Preserve the `name` paths, because `member_profiles.photo_path` references them.
- To restore: recreate the `avatars` bucket (public, 2 MB limit, `image/jpeg|png|webp`), re-upload objects to the same paths, then spot-check profile pages.
- Missing photos degrade to initials in the avatar component; they do not break attendance or points.

If photos cannot be recovered, ask affected members to re-upload. Do not guess or invent images.

## Recovery scenarios

| Scenario | Action |
| --- | --- |
| Bad ledger grant | `reverse_grant` with actor + reason; audit entry; never delete |
| Missed checkout | Admin attendance correction with `set_checkout` then `qualify` (audited) |
| Accidental card replacement | Issue a new card; old `/c/` stays revoked; `/m/` unchanged |
| Wrong member status | Restore status in admin UI with reason; audit records it |
| Failed migration | Stop deploys; restore the pre-migration dump into a disposable project; fix forward with a new migration; do not hand-edit production |
| Deleted Auth user | Recreate only with an approved identity decision; membership/ledger history will not silently reappear |
| Compromised service key | Rotate in Supabase and Vercel immediately; redeploy; review audit log and device secrets |

## What is explicitly not covered

- Automated scheduled backups, PITR retention, and off-site backup replication are not configured by this repository.
- A full Auth-user export/restore has not been rehearsed.
- The restore procedure above has not been executed for this project (no disposable project/authorization was available).
