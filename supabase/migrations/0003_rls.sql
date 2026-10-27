-- ---------------------------------------------------------------------------
-- 0003 — Row Level Security, grants and storage policies.
-- Deny by default. Members read only their own rows; admins read everything.
-- All writes flow through the server using service_role + transactional
-- functions, so no member/admin write policies exist for sensitive tables.
-- ---------------------------------------------------------------------------

alter table public.user_roles enable row level security;
alter table public.member_invitations enable row level security;
alter table public.members enable row level security;
alter table public.member_private enable row level security;
alter table public.member_profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_sessions enable row level security;
alter table public.point_ledger enable row level security;
alter table public.star_ledger enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_audit_events enable row level security;
alter table public.rewards enable row level security;
alter table public.redemptions enable row level security;
alter table public.card_credentials enable row level security;
alter table public.card_write_jobs enable row level security;
alter table public.devices enable row level security;
alter table public.device_scans enable row level security;
alter table public.audit_log enable row level security;

-- Strip default privileges from API roles; add precisely what each needs.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema public to anon, authenticated;

-- Public content ------------------------------------------------------------
grant select on public.events to anon, authenticated;
grant select on public.event_sessions to anon, authenticated;

create policy "events are publicly readable when published and public"
  on public.events for select
  to anon, authenticated
  using (status = 'published' and is_public = true);

create policy "sessions of published public events are readable"
  on public.event_sessions for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_sessions.event_id
        and e.status = 'published'
        and e.is_public = true
    )
  );

create policy "admins read all events"
  on public.events for select
  to authenticated
  using (public.is_admin());

create policy "admins read all sessions"
  on public.event_sessions for select
  to authenticated
  using (public.is_admin());

-- Members -------------------------------------------------------------------
grant select on public.members, public.member_profiles, public.member_private to authenticated;
grant select on public.point_ledger, public.star_ledger, public.attendance_records to authenticated;
grant select on public.redemptions, public.rewards to authenticated;
grant select on public.card_credentials, public.device_scans to authenticated;

create policy "members read their own member row"
  on public.members for select
  to authenticated
  using (auth_user_id = auth.uid());

create policy "members read their own profile"
  on public.member_profiles for select
  to authenticated
  using (member_id = public.current_member_id());

create policy "members read their own private record"
  on public.member_private for select
  to authenticated
  using (member_id = public.current_member_id());

create policy "members read their own point ledger"
  on public.point_ledger for select
  to authenticated
  using (member_id = public.current_member_id());

create policy "members read their own star ledger"
  on public.star_ledger for select
  to authenticated
  using (member_id = public.current_member_id());

create policy "members read their own attendance"
  on public.attendance_records for select
  to authenticated
  using (member_id = public.current_member_id());

create policy "members read their own redemptions"
  on public.redemptions for select
  to authenticated
  using (member_id = public.current_member_id());

create policy "members read their own card metadata"
  on public.card_credentials for select
  to authenticated
  using (member_id = public.current_member_id());

create policy "members read scans addressed to them"
  on public.device_scans for select
  to authenticated
  using (member_id = public.current_member_id());

create policy "members read active rewards"
  on public.rewards for select
  to authenticated
  using (is_active = true);

-- Admin read policies -------------------------------------------------------
create policy "admins read roles" on public.user_roles for select
  to authenticated using (public.is_admin());

create policy "admins read invitations" on public.member_invitations for select
  to authenticated using (public.is_admin());

create policy "admins read all members" on public.members for select
  to authenticated using (public.is_admin());

create policy "admins read all profiles" on public.member_profiles for select
  to authenticated using (public.is_admin());

create policy "admins read private member data" on public.member_private for select
  to authenticated using (public.is_admin());

create policy "admins read all points" on public.point_ledger for select
  to authenticated using (public.is_admin());

create policy "admins read all stars" on public.star_ledger for select
  to authenticated using (public.is_admin());

create policy "admins read all attendance" on public.attendance_records for select
  to authenticated using (public.is_admin());

create policy "admins read attendance audit" on public.attendance_audit_events for select
  to authenticated using (public.is_admin());

create policy "admins read all rewards" on public.rewards for select
  to authenticated using (public.is_admin());

create policy "admins read all redemptions" on public.redemptions for select
  to authenticated using (public.is_admin());

create policy "admins read cards" on public.card_credentials for select
  to authenticated using (public.is_admin());

create policy "admins read write jobs" on public.card_write_jobs for select
  to authenticated using (public.is_admin());

create policy "admins read devices" on public.devices for select
  to authenticated using (public.is_admin());

create policy "admins read scans" on public.device_scans for select
  to authenticated using (public.is_admin());

create policy "admins read audit log" on public.audit_log for select
  to authenticated using (public.is_admin());

grant select on public.attendance_audit_events, public.card_write_jobs, public.devices,
  public.audit_log, public.member_invitations, public.user_roles to authenticated;

-- Re-grant projections after the blanket revoke above (views are included in
-- "all tables in schema public").
grant select on public.public_profiles, public.leaderboard to anon, authenticated;
grant select on public.member_balances to authenticated;

-- Explicitly refuse member writes on identity/ledger/attendance tables. The
-- server uses service_role, which bypasses RLS only after authorization.
-- (No INSERT/UPDATE/DELETE policies exist for authenticated members.)

-- Storage -------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars are publicly readable" on storage.objects;
create policy "avatars are publicly readable"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

-- Direct client uploads are intentionally refused: photos are re-encoded and
-- validated by the server (service_role) before they reach this bucket.
drop policy if exists "avatars are server-managed" on storage.objects;
