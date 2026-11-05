-- ---------------------------------------------------------------------------
-- 0019 — Permanent delete for superadmins.
--
-- Until now nothing could be removed: an event was cancelled, a reward hidden,
-- a card switched off, a member archived. A superadmin can now delete any of
-- them for good. Each delete is one transaction that checks the actor, removes
-- the record with what hangs off it, and writes the audit entry, so a delete
-- cannot happen without leaving its record.
--
-- A delete does not take back points or stars. The ledgers stay append-only:
-- a row that pointed at a deleted event or reward request keeps its amount and
-- description and loses only the link.
--
-- The audit log is the one thing nobody can delete. Its guard used to share the
-- erasure exception with the ledgers; it now has a guard of its own with no
-- exception, so not even a function running an erasure can change it.
-- ---------------------------------------------------------------------------

create function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log_is_permanent' using errcode = 'P0001';
end;
$$;

comment on function public.prevent_audit_mutation() is
  'The audit log is append-only with no exception, including account erasure and superadmin deletes.';

drop trigger audit_log_append_only on public.audit_log;
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.prevent_audit_mutation();

create function public.delete_record(p_kind text, p_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_target_type text := p_kind;
  v_target_id text := p_id::text;
  v_member_id uuid;
  v_auth_user_id uuid;
  v_status text;
  v_qualified boolean;
begin
  if p_id is null or p_actor is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  -- Not is_superadmin(): that is an RLS helper tied to the caller's own session,
  -- and this runs for the server on the actor's behalf.
  if not exists (
    select 1 from public.user_roles ur
    where ur.auth_user_id = p_actor
      and ur.role = 'superadmin'
      and ur.revoked_at is null
  ) then
    raise exception 'superadmin_required' using errcode = 'P0001';
  end if;

  if p_kind = 'event' then
    select jsonb_build_object(
      'name', e.name,
      'status', e.status,
      'starts_at', e.starts_at,
      'attendance', (
        select count(*)
        from public.attendance_records a
        join public.event_sessions s on s.id = a.session_id
        where s.event_id = e.id
      )
    )
    into v_before
    from public.events e
    where e.id = p_id
    for update;
    if v_before is null then
      raise exception 'not_found' using errcode = 'P0001';
    end if;

    -- Sessions and attendance go with the event. The ledgers keep what was
    -- earned; clearing their link to the event is an update, so the append-only
    -- guard is lifted for this statement only.
    perform set_config('app.member_erasure', 'on', true);
    delete from public.events where id = p_id;
    perform set_config('app.member_erasure', 'off', true);

  elsif p_kind = 'reward' then
    select jsonb_build_object(
      'name', r.name,
      'requests', (select count(*) from public.redemptions d where d.reward_id = r.id)
    )
    into v_before
    from public.rewards r
    where r.id = p_id
    for update;
    if v_before is null then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    -- A waiting request has already been paid for, so it is decided first.
    if exists (
      select 1 from public.redemptions d
      where d.reward_id = p_id and d.status in ('requested', 'approved')
    ) then
      raise exception 'reward_has_open_requests' using errcode = 'P0001';
    end if;

    perform set_config('app.member_erasure', 'on', true);
    delete from public.redemptions where reward_id = p_id;
    delete from public.rewards where id = p_id;
    perform set_config('app.member_erasure', 'off', true);

  elsif p_kind = 'redemption' then
    select d.member_id, d.status, jsonb_build_object('name', d.reward_name_snapshot, 'status', d.status)
    into v_member_id, v_status, v_before
    from public.redemptions d
    where d.id = p_id
    for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    if v_status in ('requested', 'approved') then
      raise exception 'redemption_still_open' using errcode = 'P0001';
    end if;

    perform set_config('app.member_erasure', 'on', true);
    delete from public.redemptions where id = p_id;
    perform set_config('app.member_erasure', 'off', true);
    v_target_type := 'member';
    v_target_id := v_member_id::text;

  elsif p_kind = 'card' then
    select c.member_id, jsonb_build_object('status', c.status)
    into v_member_id, v_before
    from public.card_credentials c
    where c.id = p_id
    for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0001';
    end if;

    delete from public.card_credentials where id = p_id;
    v_target_type := 'member';
    v_target_id := v_member_id::text;

  elsif p_kind = 'attendance' then
    select a.member_id, a.qualified, jsonb_build_object('name', e.name, 'state', a.state)
    into v_member_id, v_qualified, v_before
    from public.attendance_records a
    join public.event_sessions s on s.id = a.session_id
    join public.events e on e.id = s.event_id
    where a.id = p_id
    for update of a;
    if not found then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    -- Points given for it are taken back through a correction, which leaves a
    -- compensating entry. Deleting first would leave points with no attendance.
    if v_qualified then
      raise exception 'attendance_has_points' using errcode = 'P0001';
    end if;

    perform set_config('app.member_erasure', 'on', true);
    delete from public.attendance_records where id = p_id;
    perform set_config('app.member_erasure', 'off', true);
    v_target_type := 'member';
    v_target_id := v_member_id::text;

  elsif p_kind = 'invitation' then
    select i.auth_user_id, i.status, jsonb_build_object('status', i.status)
    into v_auth_user_id, v_status, v_before
    from public.member_invitations i
    where i.id = p_id
    for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    if v_status = 'accepted' then
      raise exception 'invitation_in_use' using errcode = 'P0001';
    end if;

    delete from public.member_invitations where id = p_id;
    -- The account made for an invitation nobody accepted has nothing else on it.
    -- Anyone who is, or ever was, a member or an organizer keeps their account.
    if v_auth_user_id is not null
      and not exists (select 1 from public.members m where m.auth_user_id = v_auth_user_id)
      and not exists (select 1 from public.user_roles r where r.auth_user_id = v_auth_user_id)
      and not exists (
        select 1 from public.member_invitations i where i.auth_user_id = v_auth_user_id
      )
    then
      delete from auth.users where id = v_auth_user_id;
    end if;
    v_target_type := 'member_invitation';

  elsif p_kind = 'user' then
    if p_id = p_actor then
      raise exception 'cannot_delete_self' using errcode = 'P0001';
    end if;
    -- No name or address is recorded: an erased person's details must not live
    -- on in the audit log.
    select jsonb_build_object(
      'kind', coalesce((select m.kind from public.members m where m.auth_user_id = p_id), 'account'),
      'roles', coalesce(
        (
          select jsonb_agg(r.role order by r.role)
          from public.user_roles r
          where r.auth_user_id = p_id and r.revoked_at is null
        ),
        '[]'::jsonb
      )
    )
    into v_before;

    -- Invitations hold the person's address and would otherwise outlive them.
    delete from public.member_invitations where auth_user_id = p_id;
    -- Removes the account, profile, card, attendance, points and stars, and
    -- raises auth_user_not_found for an unknown id. The actor is a superadmin
    -- and is not the target, so one always remains.
    perform public.erase_member(p_id);
    perform set_config('app.member_erasure', 'off', true);

  else
    raise exception 'unknown_kind' using errcode = 'P0001';
  end if;

  insert into public.audit_log (actor_auth_id, action, target_type, target_id, before)
  values (p_actor, p_kind || '.deleted', v_target_type, v_target_id, v_before);

  return v_before;
end;
$$;

comment on function public.delete_record(text, uuid, uuid) is
  'Superadmin-only permanent delete of one record, with its audit entry in the same transaction. Points and stars already given are kept.';

revoke all on function public.prevent_audit_mutation() from public, anon, authenticated;
revoke all on function public.delete_record(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_record(text, uuid, uuid) to service_role;
