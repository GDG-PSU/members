-- A user is exactly one of: member, admin, superadmin.
--
-- Promoting a member to staff deletes the member row (and its dependent cards,
-- attendance, ledger, redemptions) while preserving auth.users. Demoting staff
-- to member revokes staff roles and creates a pending member invitation marked
-- as not needing a new password, so the existing account can finish member
-- profile setup on its next sign-in.

alter table public.member_invitations
  add column if not exists requires_password boolean not null default true;

comment on column public.member_invitations.requires_password is
  'False when an existing staff account is demoted to member; setup keeps the current password.';

create or replace function public.set_user_type(
  p_auth_user_id uuid,
  p_role text,
  p_actor uuid,
  p_paid_since date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_member_id uuid;
  v_invitation_id uuid;
  v_roles text[];
  v_superadmin_count integer;
begin
  if p_auth_user_id is null then
    raise exception 'auth_user_id_required' using errcode = 'P0001';
  end if;
  if p_role not in ('member', 'admin', 'superadmin') then
    raise exception 'invalid_user_type' using errcode = 'P0001';
  end if;

  select lower(email) into v_email
  from auth.users
  where id = p_auth_user_id
  for update;

  if v_email is null then
    raise exception 'auth_user_not_found' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(role), '{}'::text[]) into v_roles
  from public.user_roles
  where auth_user_id = p_auth_user_id
    and revoked_at is null;

  -- Removing superadmin access must never strand the installation.
  if 'superadmin' = any(v_roles) and p_role <> 'superadmin' then
    select count(*) into v_superadmin_count
    from public.user_roles
    where role = 'superadmin'
      and revoked_at is null;
    if v_superadmin_count <= 1 then
      raise exception 'last_superadmin' using errcode = 'P0001';
    end if;
  end if;

  if p_role in ('admin', 'superadmin') then
    -- Member data is no longer meaningful once this account is staff. The
    -- transaction-local flag lets append-only ledger/attendance guards accept
    -- the cascade; audit_log intentionally survives.
    select id into v_member_id
    from public.members
    where auth_user_id = p_auth_user_id
    for update;

    if v_member_id is not null then
      perform set_config('app.member_erasure', 'on', true);
      delete from public.members where id = v_member_id;
    end if;

    -- A stale member invitation must not remain visible as a second type.
    update public.member_invitations
    set status = 'revoked'
    where email = v_email
      and status = 'pending';

    update public.user_roles
    set revoked_at = now(), revoked_by = p_actor
    where auth_user_id = p_auth_user_id
      and revoked_at is null;

    insert into public.user_roles (
      auth_user_id, role, granted_by, granted_at, revoked_at, revoked_by, note
    ) values (
      p_auth_user_id, p_role, p_actor, now(), null, null, 'Role changed in Users'
    )
    on conflict (auth_user_id, role) do update
      set granted_by = excluded.granted_by,
          granted_at = now(),
          revoked_at = null,
          revoked_by = null,
          note = excluded.note;

    return jsonb_build_object(
      'role', p_role,
      'member_removed', v_member_id is not null,
      'invitation_id', null,
      'member_id', null
    );
  end if;

  -- Member: remove every staff role, then either keep an existing member row
  -- or hand the account a pending invitation for member profile setup.
  update public.user_roles
  set revoked_at = now(), revoked_by = p_actor
  where auth_user_id = p_auth_user_id
    and revoked_at is null;

  select id into v_member_id
  from public.members
  where auth_user_id = p_auth_user_id
  for update;

  if v_member_id is not null then
    update public.members
    set status = 'active'
    where id = v_member_id;

    return jsonb_build_object(
      'role', 'member',
      'member_removed', false,
      'invitation_id', null,
      'member_id', v_member_id
    );
  end if;

  select id into v_invitation_id
  from public.member_invitations
  where email = v_email
    and status = 'pending'
  order by created_at desc
  limit 1
  for update;

  if v_invitation_id is null then
    insert into public.member_invitations (
      email, status, paid_since, note, auth_user_id, created_by, requires_password
    ) values (
      v_email,
      'pending',
      coalesce(p_paid_since, current_date),
      'Member setup after staff role change',
      p_auth_user_id,
      p_actor,
      false
    )
    returning id into v_invitation_id;
  else
    update public.member_invitations
    set requires_password = false,
        auth_user_id = coalesce(auth_user_id, p_auth_user_id),
        expires_at = greatest(expires_at, now() + interval '14 days')
    where id = v_invitation_id;
  end if;

  return jsonb_build_object(
    'role', 'member',
    'member_removed', false,
    'invitation_id', v_invitation_id,
    'member_id', null
  );
end;
$$;

revoke all on function public.set_user_type(uuid, text, uuid, date) from public;
grant execute on function public.set_user_type(uuid, text, uuid, date) to service_role;
