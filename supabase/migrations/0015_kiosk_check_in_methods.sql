-- The kiosk can now start a check-in three ways: a card read, the QR code on a
-- member's digital ID, or an organizer finding the member by name or number.
-- Each attendance row records which one was used, so a check-in made without the
-- card present is visible later. An organizer still confirms every one.

alter table public.attendance_records
  add column check_in_method text not null default 'card'
    check (check_in_method in ('card', 'qr', 'manual')),
  add column check_out_method text
    check (check_out_method is null or check_out_method in ('card', 'qr', 'manual'));

comment on column public.attendance_records.check_in_method is
  'How the member was identified at check-in: card read, digital ID QR code, or found by an organizer.';

create or replace function public.confirm_scan(
  p_scan_id uuid,
  p_action text,
  p_actor uuid,
  p_reason text default null,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scan public.device_scans;
  v_session public.event_sessions;
  v_attendance public.attendance_records;
  v_duration integer;
  v_ledger_id bigint;
  v_attendance_id uuid;
  v_method text;
begin
  if p_action not in ('check_in', 'check_out', 'reject') then
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;

  select * into v_scan from public.device_scans where id = p_scan_id for update;
  if not found then
    raise exception 'scan_not_found' using errcode = 'P0001';
  end if;
  if v_scan.status <> 'pending' then
    raise exception 'scan_already_handled' using errcode = 'P0001';
  end if;
  if v_scan.expires_at < now() then
    raise exception 'scan_expired' using errcode = 'P0001';
  end if;

  -- Dismissing a scan records nothing, so it must work whatever the session,
  -- member or card state has become.
  if p_action = 'reject' then
    update public.device_scans
      set status = 'rejected', confirmed_by = p_actor, confirmed_at = now()
      where id = p_scan_id;
    insert into public.audit_log (actor_auth_id, action, target_type, target_id, reason, request_id)
    values (p_actor, 'scan.rejected', 'device_scan', p_scan_id::text, p_reason, p_request_id);
    return null;
  end if;

  if v_scan.session_id is null then
    raise exception 'scan_missing_session' using errcode = 'P0001';
  end if;

  -- Only the server writes scan metadata, but a scan with no card can never
  -- count as a card read.
  v_method := coalesce(v_scan.metadata ->> 'method', 'card');
  if v_method not in ('card', 'qr', 'manual') then
    v_method := 'card';
  end if;
  if v_scan.card_id is null and v_method = 'card' then
    v_method := 'manual';
  end if;

  select * into v_session from public.event_sessions where id = v_scan.session_id;
  if not found or not v_session.is_enabled then
    raise exception 'session_unavailable' using errcode = 'P0001';
  end if;

  -- The preview checked these, but a scan stays pending for a few minutes and
  -- any of them can change before the organizer confirms.
  perform 1 from public.events
  where id = v_session.event_id and status <> 'cancelled';
  if not found then
    raise exception 'session_unavailable' using errcode = 'P0001';
  end if;

  perform 1 from public.members
  where id = v_scan.member_id and status = 'active';
  if not found then
    raise exception 'member_not_active' using errcode = 'P0001';
  end if;

  if v_scan.card_id is not null then
    perform 1 from public.card_credentials
    where id = v_scan.card_id and status = 'active';
    if not found then
      raise exception 'card_not_active' using errcode = 'P0001';
    end if;
  end if;

  if p_action = 'check_in' then
    if now() < v_session.check_in_opens_at or now() > v_session.check_in_closes_at then
      raise exception 'outside_check_in_window' using errcode = 'P0001';
    end if;

    begin
      insert into public.attendance_records (
        member_id, session_id, checked_in_at, checked_in_by, state, check_in_method
      ) values (
        v_scan.member_id, v_scan.session_id, now(), p_actor, 'checked_in', v_method
      ) returning id into v_attendance_id;
    exception
      when unique_violation then
        raise exception 'duplicate_check_in' using errcode = 'P0001';
    end;

    update public.device_scans
      set status = 'confirmed', action = 'check_in', confirmed_by = p_actor, confirmed_at = now()
      where id = p_scan_id;

    insert into public.attendance_audit_events (attendance_id, action, actor_id, device_id, request_id, metadata)
    values (
      v_attendance_id, 'check_in_confirmed', p_actor, v_scan.device_id, p_request_id,
      jsonb_build_object('method', v_method)
    );

    insert into public.audit_log (actor_auth_id, action, target_type, target_id, request_id, after)
    values (
      p_actor, 'attendance.check_in', 'attendance', v_attendance_id::text, p_request_id,
      jsonb_build_object('method', v_method)
    );

    return v_attendance_id;
  end if;

  -- check_out
  select * into v_attendance
  from public.attendance_records
  where member_id = v_scan.member_id and session_id = v_scan.session_id
  for update;

  if not found then
    raise exception 'no_check_in_found' using errcode = 'P0001';
  end if;
  if v_attendance.checked_out_at is not null then
    raise exception 'duplicate_check_out' using errcode = 'P0001';
  end if;
  if now() < v_session.check_out_opens_at or now() > v_session.check_out_closes_at then
    raise exception 'outside_check_out_window' using errcode = 'P0001';
  end if;

  v_duration := greatest(0, floor(extract(epoch from (now() - v_attendance.checked_in_at)) / 60)::int);

  update public.attendance_records
    set checked_out_at = now(),
        checked_out_by = p_actor,
        duration_minutes = v_duration,
        state = 'completed',
        check_out_method = v_method
    where id = v_attendance.id
    returning * into v_attendance;

  update public.device_scans
    set status = 'confirmed', action = 'check_out', confirmed_by = p_actor, confirmed_at = now()
    where id = p_scan_id;

  insert into public.attendance_audit_events (attendance_id, action, actor_id, device_id, request_id, metadata)
  values (
    v_attendance.id, 'check_out_confirmed', p_actor, v_scan.device_id, p_request_id,
    jsonb_build_object(
      'duration_minutes', v_duration,
      'minimum_duration_minutes', v_session.minimum_duration_minutes,
      'method', v_method
    )
  );

  if v_duration >= v_session.minimum_duration_minutes and v_session.reward_points > 0 then
    v_ledger_id := public.grant_points(
      v_attendance.member_id,
      v_session.reward_points,
      'attendance_reward',
      public.attendance_grant_key(v_attendance.id),
      'Attendance: ' || v_session.name,
      p_actor,
      v_session.event_id,
      v_session.id,
      jsonb_build_object(
        'minimum_duration_minutes', v_session.minimum_duration_minutes,
        'reward_points', v_session.reward_points,
        'duration_minutes', v_duration,
        'session_kind', v_session.kind
      )
    );

    update public.attendance_records
      set qualified = true, reward_points = v_session.reward_points, ledger_id = v_ledger_id
      where id = v_attendance.id;
  else
    update public.attendance_records
      set qualified = false, reward_points = 0
      where id = v_attendance.id;
  end if;

  insert into public.audit_log (actor_auth_id, action, target_type, target_id, request_id, after)
  values (
    p_actor, 'attendance.check_out', 'attendance', v_attendance.id::text, p_request_id,
    jsonb_build_object('method', v_method)
  );

  return v_attendance.id;
end;
$$;
