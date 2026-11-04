-- Superadmins inherit admin access but are the only staff who can manage staff
-- roles or read the full audit log. Normal admins keep member operations and
-- can read only the invitations they created.

alter table public.user_roles
  drop constraint if exists user_roles_role_check;

alter table public.user_roles
  add constraint user_roles_role_check check (role in ('admin', 'superadmin'));

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select uid = auth.uid()
    and (auth.jwt() ->> 'aal') = 'aal2'
    and exists (
      select 1 from public.user_roles ur
      where ur.auth_user_id = uid
        and ur.role in ('admin', 'superadmin')
        and ur.revoked_at is null
    );
$$;

create or replace function public.is_superadmin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select uid = auth.uid()
    and (auth.jwt() ->> 'aal') = 'aal2'
    and exists (
      select 1 from public.user_roles ur
      where ur.auth_user_id = uid
        and ur.role = 'superadmin'
        and ur.revoked_at is null
    );
$$;

drop policy if exists "admins read roles" on public.user_roles;
create policy "superadmins read all roles" on public.user_roles for select
  to authenticated using (public.is_superadmin());

drop policy if exists "admins read invitations" on public.member_invitations;
create policy "admins read their invitations" on public.member_invitations for select
  to authenticated using (public.is_admin() and created_by = auth.uid());
create policy "superadmins read all invitations" on public.member_invitations for select
  to authenticated using (public.is_superadmin());

drop policy if exists "admins read audit log" on public.audit_log;
create policy "superadmins read audit log" on public.audit_log for select
  to authenticated using (public.is_superadmin());

-- Promote the initial owner. The previous admin row is retired so a user has
-- one effective staff role; the app still resolves superadmin over admin for
-- any legacy duplicate rows.
with target as (
  select id
  from auth.users
  where lower(email) = lower('sainaman@psu.edu')
),
retired_admin as (
  update public.user_roles ur
  set revoked_at = now(),
      revoked_by = null,
      note = 'Promoted to superadmin'
  from target t
  where ur.auth_user_id = t.id
    and ur.role = 'admin'
    and ur.revoked_at is null
  returning ur.auth_user_id
)
insert into public.user_roles (auth_user_id, role, granted_by, granted_at, note)
select t.id, 'superadmin', null, now(), 'Initial superadmin'
from target t
on conflict (auth_user_id, role) do update
  set revoked_at = null,
      revoked_by = null,
      granted_at = now(),
      note = excluded.note;
