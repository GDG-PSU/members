-- ---------------------------------------------------------------------------
-- 0002 — Transactional domain functions, public projections and balances.
-- Every function is SECURITY DEFINER with a fixed empty search_path and
-- schema-qualified objects. Write functions are granted to service_role only:
-- browser/member clients can never call them directly.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Audit helper
-- ---------------------------------------------------------------------------
create or replace function public.log_audit(
  p_actor uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_reason text default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_request_id text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_auth_id, action, target_type, target_id, reason, before, after, request_id)
  values (p_actor, p_action, p_target_type, p_target_id, p_reason, p_before, p_after, p_request_id);
$$;

-- ---------------------------------------------------------------------------
-- Points + stars
-- ---------------------------------------------------------------------------
create or replace function public.grant_points(
  p_member_id uuid,
  p_points integer,
  p_kind text,
  p_source_key text,
  p_description text,
  p_actor uuid default null,
  p_event_id uuid default null,
  p_session_id uuid default null,
  p_rule_snapshot jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing bigint;
  v_ledger_id bigint;
begin
  if p_points is null or p_points = 0 then
    raise exception 'invalid_points' using errcode = 'P0001';
  end if;
  if p_kind not in ('attendance_reward', 'interaction_reward', 'admin_adjustment') then
    raise exception 'invalid_grant_kind' using errcode = 'P0001';
  end if;
  if p_description is null or char_length(p_description) < 1 then
    raise exception 'description_required' using errcode = 'P0001';
  end if;

  select id into v_existing from public.point_ledger where source_key = p_source_key;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.point_ledger (
    member_id, delta, kind, source_key, description, actor_id, event_id, session_id, rule_snapshot
  ) values (
    p_member_id, p_points, p_kind, p_source_key, p_description, p_actor, p_event_id, p_session_id,
    coalesce(p_rule_snapshot, '{}'::jsonb)
  ) returning id into v_ledger_id;

  if p_points > 0 then
    insert into public.star_ledger (
      member_id, delta, kind, source_key, point_ledger_id, description
    ) values (
      p_member_id,
      p_points,
      case when p_kind = 'interaction_reward' then 'interaction_reward' else 'attendance_reward' end,
      'star:' || p_source_key,
      v_ledger_id,
      p_description
    ) on conflict (source_key) do nothing;
  end if;

  return v_ledger_id;
exception
  when unique_violation then
    select id into v_existing from public.point_ledger where source_key = p_source_key;
    if v_existing is null then
      raise;
    end if;
    return v_existing;
end;
$$;

create or replace function public.reverse_grant(
  p_ledger_id bigint,
  p_actor uuid,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orig public.point_ledger;
  v_new bigint;
  v_balance integer;
begin
  select * into v_orig from public.point_ledger where id = p_ledger_id for update;
  if not found then
    raise exception 'ledger_entry_not_found' using errcode = 'P0001';
  end if;
  if v_orig.delta <= 0 or v_orig.kind in ('redemption', 'redemption_refund', 'reversal') then
    raise exception 'only_positive_grants_are_reversible' using errcode = 'P0001';
  end if;
  if p_reason is null or char_length(p_reason) < 3 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select coalesce(sum(delta), 0)::int into v_balance
  from public.point_ledger where member_id = v_orig.member_id;
  if v_balance < v_orig.delta then
    raise exception 'insufficient_balance_for_reversal' using errcode = 'P0001';
  end if;

  insert into public.point_ledger (
    member_id, delta, kind, source_key, description, actor_id, event_id, session_id, rule_snapshot
  ) values (
    v_orig.member_id, -v_orig.delta, 'reversal', 'reversal:' || p_ledger_id,
    p_reason, p_actor, v_orig.event_id, v_orig.session_id, v_orig.rule_snapshot
  ) on conflict (source_key) do nothing
  returning id into v_new;

  if v_new is null then
    select id into v_new from public.point_ledger where source_key = 'reversal:' || p_ledger_id;
    return v_new;
  end if;

  insert into public.star_ledger (member_id, delta, kind, source_key, point_ledger_id, description)
  values (
    v_orig.member_id, -v_orig.delta, 'reversal', 'star:reversal:' || p_ledger_id, v_new, p_reason
  ) on conflict (source_key) do nothing;

  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Redemptions
-- ---------------------------------------------------------------------------
create or replace function public.redeem_reward(
  p_member_id uuid,
  p_reward_id uuid,
  p_quantity integer,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward public.rewards;
  v_redemption_id uuid;
  v_cost integer;
  v_balance integer;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 5 then
    raise exception 'invalid_quantity' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 then
    raise exception 'idempotency_key_required' using errcode = 'P0001';
  end if;

  select id into v_redemption_id
  from public.redemptions
  where member_id = p_member_id and idempotency_key = p_idempotency_key;
  if v_redemption_id is not null then
    return v_redemption_id;
  end if;

  perform 1 from public.members
  where id = p_member_id and status = 'active'
  for update;
  if not found then
    raise exception 'member_not_active' using errcode = 'P0001';
  end if;

  select * into v_reward from public.rewards where id = p_reward_id for update;
  if not found or not v_reward.is_active then
    raise exception 'reward_unavailable' using errcode = 'P0001';
  end if;
  if v_reward.inventory is not null and v_reward.inventory < p_quantity then
    raise exception 'out_of_stock' using errcode = 'P0001';
  end if;

  v_cost := v_reward.cost_points * p_quantity;

  select coalesce(sum(delta), 0)::int into v_balance
  from public.point_ledger where member_id = p_member_id;
  if v_balance < v_cost then
    raise exception 'insufficient_points' using errcode = 'P0001';
  end if;

  insert into public.redemptions (
    member_id, reward_id, reward_name_snapshot, cost_points_snapshot, quantity, points_debited,
    status, idempotency_key
  ) values (
    p_member_id, p_reward_id, v_reward.name, v_reward.cost_points, p_quantity, v_cost,
    'requested', p_idempotency_key
  ) returning id into v_redemption_id;

  insert into public.point_ledger (
    member_id, delta, kind, source_key, description, redemption_id, rule_snapshot
  ) values (
    p_member_id, -v_cost, 'redemption', 'redemption:' || v_redemption_id,
    'Redeemed: ' || v_reward.name, v_redemption_id,
    jsonb_build_object(
      'reward_id', p_reward_id,
      'quantity', p_quantity,
      'unit_cost', v_reward.cost_points,
      'reward_name', v_reward.name
    )
  );

  if v_reward.inventory is not null then
    update public.rewards set inventory = inventory - p_quantity where id = p_reward_id;
  end if;

  return v_redemption_id;
end;
$$;

create or replace function public.decide_redemption(
  p_redemption_id uuid,
  p_action text,
  p_actor uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.redemptions;
  v_reward_inventory integer;
begin
  select * into v_r from public.redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'redemption_not_found' using errcode = 'P0001';
  end if;

  if p_action = 'approve' then
    if v_r.status <> 'requested' then
      raise exception 'invalid_transition' using errcode = 'P0001';
    end if;
    update public.redemptions
      set status = 'approved', decided_by = p_actor, decided_at = now(), reason = p_reason
      where id = p_redemption_id;

  elsif p_action = 'fulfil' then
    if v_r.status <> 'approved' then
      raise exception 'invalid_transition' using errcode = 'P0001';
    end if;
    update public.redemptions
      set status = 'fulfilled', fulfilled_at = now(), reason = coalesce(p_reason, reason)
      where id = p_redemption_id;

  elsif p_action in ('reject', 'cancel') then
    if v_r.status not in ('requested', 'approved') then
      raise exception 'invalid_transition' using errcode = 'P0001';
    end if;
    if p_reason is null or char_length(p_reason) < 3 then
      raise exception 'reason_required' using errcode = 'P0001';
    end if;

    update public.redemptions
      set status = case when p_action = 'cancel' then 'cancelled' else 'rejected' end,
          decided_by = p_actor,
          decided_at = now(),
          reason = p_reason
      where id = p_redemption_id;

    insert into public.point_ledger (
      member_id, delta, kind, source_key, description, actor_id, redemption_id, rule_snapshot
    ) values (
      v_r.member_id, v_r.points_debited, 'redemption_refund', 'refund:' || p_redemption_id,
      'Refund: ' || v_r.reward_name_snapshot, p_actor, p_redemption_id,
      jsonb_build_object('reason', p_reason, 'action', p_action)
    ) on conflict (source_key) do nothing;

    select inventory into v_reward_inventory from public.rewards where id = v_r.reward_id for update;
    if v_reward_inventory is not null then
      update public.rewards set inventory = inventory + v_r.quantity where id = v_r.reward_id;
    end if;
  else
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Card lifecycle and one-time write jobs
-- ---------------------------------------------------------------------------
create or replace function public.prepare_card(
  p_member_id uuid,
  p_token_hash text,
  p_token_ciphertext text,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card_id uuid;
begin
  perform 1 from public.members where id = p_member_id for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0001';
  end if;

  update public.card_credentials
    set status = 'replaced', revoked_at = now(), revoked_by = p_actor, revoke_reason = 'Replaced by new card'
    where member_id = p_member_id and status in ('active', 'pending');

  insert into public.card_credentials (
    member_id, token_hash, token_ciphertext, status, replaces_card_id, created_by
  ) values (
    p_member_id,
    p_token_hash,
    p_token_ciphertext,
    'pending',
    (
      select id from public.card_credentials
      where member_id = p_member_id and status = 'replaced'
      order by created_at desc limit 1
    ),
    p_actor
  ) returning id into v_card_id;

  return v_card_id;
end;
$$;

create or replace function public.activate_card(p_card_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.card_credentials;
begin
  select * into v_card from public.card_credentials where id = p_card_id for update;
  if not found then
    raise exception 'card_not_found' using errcode = 'P0001';
  end if;
  if v_card.status not in ('pending', 'active') then
    raise exception 'card_not_activatable' using errcode = 'P0001';
  end if;

  update public.card_credentials
    set status = 'replaced', revoked_at = now(), revoked_by = p_actor, revoke_reason = 'Superseded'
    where member_id = v_card.member_id and status = 'active' and id <> p_card_id;

  update public.card_credentials
    set status = 'active', issued_at = now()
    where id = p_card_id;
end;
$$;

create or replace function public.revoke_card(p_card_id uuid, p_actor uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_reason is null or char_length(p_reason) < 3 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  update public.card_credentials
    set status = case when status = 'pending' then 'revoked' else 'lost' end,
        revoked_at = now(),
        revoked_by = p_actor,
        revoke_reason = p_reason
    where id = p_card_id and status in ('pending', 'active');
  if not found then
    raise exception 'card_not_revocable' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.queue_write_job(
  p_card_id uuid,
  p_device_uuid uuid,
  p_payload_ciphertext text,
  p_nonce text,
  p_ttl_seconds integer,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.card_credentials;
  v_device public.devices;
  v_job_id uuid;
begin
  select * into v_card from public.card_credentials where id = p_card_id for update;
  if not found or v_card.status <> 'pending' then
    raise exception 'card_not_writable' using errcode = 'P0001';
  end if;

  select * into v_device from public.devices where id = p_device_uuid for update;
  if not found or v_device.status <> 'active' or v_device.mode <> 'writer' then
    raise exception 'device_not_in_writer_mode' using errcode = 'P0001';
  end if;

  update public.card_write_jobs
    set status = 'cancelled', completed_at = now()
    where card_id = p_card_id and status in ('queued', 'claimed');

  insert into public.card_write_jobs (
    device_id, member_id, card_id, payload_ciphertext, nonce, expires_at, created_by
  ) values (
    p_device_uuid, v_card.member_id, p_card_id, p_payload_ciphertext, p_nonce,
    now() + make_interval(secs => greatest(30, least(p_ttl_seconds, 900))), p_actor
  ) returning id into v_job_id;

  return v_job_id;
end;
$$;

create or replace function public.claim_write_job(p_device_uuid uuid, p_firmware_version text)
returns table (
  job_id uuid,
  card_id uuid,
  member_id uuid,
  payload_ciphertext text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  update public.card_write_jobs j
    set status = 'expired', completed_at = now()
    where j.device_id = p_device_uuid and j.status in ('queued', 'claimed') and j.expires_at < now();

  select j.id into v_job_id
  from public.card_write_jobs j
  where j.device_id = p_device_uuid and j.status = 'queued' and j.expires_at > now()
  order by j.created_at asc
  for update skip locked
  limit 1;

  if v_job_id is null then
    return;
  end if;

  return query
  update public.card_write_jobs j
    set status = 'claimed', claimed_at = now(), attempt_count = j.attempt_count + 1
    where j.id = v_job_id
    returning j.id, j.card_id, j.member_id, j.payload_ciphertext, j.expires_at;

  update public.devices
    set last_seen_at = now(), firmware_version = p_firmware_version
    where id = p_device_uuid;
end;
$$;

create or replace function public.complete_write_job(
  p_job_id uuid,
  p_device_uuid uuid,
  p_status text,
  p_read_back_matches boolean,
  p_failure_code text,
  p_ndef_length integer,
  p_actor uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.card_write_jobs;
begin
  if p_status not in ('written', 'failed') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  select * into v_job from public.card_write_jobs where id = p_job_id for update;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0001';
  end if;
  if v_job.device_id <> p_device_uuid then
    raise exception 'job_device_mismatch' using errcode = 'P0001';
  end if;
  if v_job.status = 'written' then
    return 'written';
  end if;
  if v_job.status <> 'claimed' then
    raise exception 'job_not_claimed' using errcode = 'P0001';
  end if;
  if v_job.expires_at < now() then
    update public.card_write_jobs set status = 'expired', completed_at = now() where id = p_job_id;
    raise exception 'job_expired' using errcode = 'P0001';
  end if;

  if p_status = 'written' and p_read_back_matches is not true then
    raise exception 'read_back_verification_required' using errcode = 'P0001';
  end if;

  update public.card_write_jobs
    set status = p_status,
        completed_at = now(),
        failure_code = p_failure_code,
        result = jsonb_build_object(
          'read_back_matches', coalesce(p_read_back_matches, false),
          'ndef_length', p_ndef_length
        ),
        payload_ciphertext = 'destroyed'
    where id = p_job_id;

  if p_status = 'written' then
    perform public.activate_card(v_job.card_id, p_actor);
  end if;

  return p_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Member setup completion (idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.complete_member_setup(
  p_auth_user_id uuid,
  p_email text,
  p_display_name text,
  p_profile_slug text,
  p_photo_path text,
  p_public_number text,
  p_about text,
  p_links jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.member_invitations;
  v_member_id uuid;
begin
  select id into v_member_id from public.members where auth_user_id = p_auth_user_id;
  if v_member_id is not null then
    return v_member_id;
  end if;

  select * into v_invitation
  from public.member_invitations
  where email = lower(p_email) and status = 'pending'
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'invitation_not_found' using errcode = 'P0001';
  end if;
  if v_invitation.expires_at < now() then
    update public.member_invitations set status = 'expired' where id = v_invitation.id;
    raise exception 'invitation_expired' using errcode = 'P0001';
  end if;

  insert into public.members (auth_user_id, public_number, member_since, invitation_id)
  values (p_auth_user_id, p_public_number, v_invitation.paid_since, v_invitation.id)
  returning id into v_member_id;

  insert into public.member_private (member_id, email)
  values (v_member_id, lower(p_email));

  insert into public.member_profiles (
    member_id, profile_slug, display_name, photo_path, about, links
  ) values (
    v_member_id, p_profile_slug, p_display_name, p_photo_path, nullif(p_about, ''), coalesce(p_links, '[]'::jsonb)
  );

  update public.member_invitations
    set status = 'accepted', accepted_at = now(), auth_user_id = p_auth_user_id
    where id = v_invitation.id;

  return v_member_id;
exception
  when unique_violation then
    select id into v_member_id from public.members where auth_user_id = p_auth_user_id;
    if v_member_id is null then
      raise;
    end if;
    return v_member_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Attendance state machine (admin-confirmed only)
-- ---------------------------------------------------------------------------
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
    update public.device_scans set status = 'expired' where id = p_scan_id;
    raise exception 'scan_expired' using errcode = 'P0001';
  end if;
  if v_scan.session_id is null then
    raise exception 'scan_missing_session' using errcode = 'P0001';
  end if;

  select * into v_session from public.event_sessions where id = v_scan.session_id;
  if not found or not v_session.is_enabled then
    raise exception 'session_unavailable' using errcode = 'P0001';
  end if;

  if p_action = 'reject' then
    update public.device_scans
      set status = 'rejected', confirmed_by = p_actor, confirmed_at = now()
      where id = p_scan_id;
    insert into public.audit_log (actor_auth_id, action, target_type, target_id, reason, request_id)
    values (p_actor, 'scan.rejected', 'device_scan', p_scan_id::text, p_reason, p_request_id);
    return null;
  end if;

  if p_action = 'check_in' then
    if now() < v_session.check_in_opens_at or now() > v_session.check_in_closes_at then
      raise exception 'outside_check_in_window' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.attendance_records
      where member_id = v_scan.member_id and session_id = v_scan.session_id
    ) then
      raise exception 'duplicate_check_in' using errcode = 'P0001';
    end if;

    insert into public.attendance_records (
      member_id, session_id, checked_in_at, checked_in_by, state
    ) values (
      v_scan.member_id, v_scan.session_id, now(), p_actor, 'checked_in'
    ) returning id into v_attendance_id;

    update public.device_scans
      set status = 'confirmed', action = 'check_in', confirmed_by = p_actor, confirmed_at = now()
      where id = p_scan_id;

    insert into public.attendance_audit_events (attendance_id, action, actor_id, device_id, request_id)
    values (v_attendance_id, 'check_in_confirmed', p_actor, v_scan.device_id, p_request_id);

    insert into public.audit_log (actor_auth_id, action, target_type, target_id, request_id)
    values (p_actor, 'attendance.check_in', 'attendance', v_attendance_id::text, p_request_id);

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
        state = 'completed'
    where id = v_attendance.id
    returning * into v_attendance;

  update public.device_scans
    set status = 'confirmed', action = 'check_out', confirmed_by = p_actor, confirmed_at = now()
    where id = p_scan_id;

  insert into public.attendance_audit_events (attendance_id, action, actor_id, device_id, request_id, metadata)
  values (
    v_attendance.id, 'check_out_confirmed', p_actor, v_scan.device_id, p_request_id,
    jsonb_build_object('duration_minutes', v_duration, 'minimum_duration_minutes', v_session.minimum_duration_minutes)
  );

  if v_duration >= v_session.minimum_duration_minutes and v_session.reward_points > 0 then
    v_ledger_id := public.grant_points(
      v_attendance.member_id,
      v_session.reward_points,
      'attendance_reward',
      'attendance:' || v_attendance.id,
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

  insert into public.audit_log (actor_auth_id, action, target_type, target_id, request_id)
  values (p_actor, 'attendance.check_out', 'attendance', v_attendance.id::text, p_request_id);

  return v_attendance.id;
end;
$$;

create or replace function public.correct_attendance(
  p_attendance_id uuid,
  p_action text,
  p_checked_out_at timestamptz,
  p_reason text,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.attendance_records;
  v_session public.event_sessions;
  v_duration integer;
  v_ledger bigint;
begin
  if p_reason is null or char_length(p_reason) < 5 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select * into v_a from public.attendance_records where id = p_attendance_id for update;
  if not found then
    raise exception 'attendance_not_found' using errcode = 'P0001';
  end if;

  select * into v_session from public.event_sessions where id = v_a.session_id;

  if p_action = 'set_checkout' then
    if p_checked_out_at is null then
      raise exception 'checkout_time_required' using errcode = 'P0001';
    end if;
    v_duration := greatest(0, floor(extract(epoch from (p_checked_out_at - v_a.checked_in_at)) / 60)::int);
    update public.attendance_records
      set checked_out_at = p_checked_out_at,
          checked_out_by = p_actor,
          duration_minutes = v_duration,
          state = 'completed'
      where id = p_attendance_id;

  elsif p_action = 'clear_checkout' then
    if v_a.ledger_id is not null then
      perform public.reverse_grant(v_a.ledger_id, p_actor, p_reason);
    end if;
    update public.attendance_records
      set checked_out_at = null,
          checked_out_by = null,
          duration_minutes = null,
          state = 'checked_in',
          qualified = false,
          reward_points = 0,
          ledger_id = null
      where id = p_attendance_id;

  elsif p_action = 'qualify' then
    if v_a.checked_out_at is null then
      raise exception 'checkout_required_before_qualifying' using errcode = 'P0001';
    end if;
    if v_a.qualified then
      raise exception 'already_qualified' using errcode = 'P0001';
    end if;
    if v_session.reward_points > 0 then
      v_ledger := public.grant_points(
        v_a.member_id,
        v_session.reward_points,
        'attendance_reward',
        'attendance:' || v_a.id,
        'Attendance correction: ' || v_session.name,
        p_actor,
        v_session.event_id,
        v_session.id,
        jsonb_build_object('minimum_duration_minutes', v_session.minimum_duration_minutes, 'reward_points', v_session.reward_points, 'correction', true)
      );
    end if;
    update public.attendance_records
      set qualified = true, reward_points = v_session.reward_points, ledger_id = v_ledger
      where id = p_attendance_id;

  elsif p_action = 'disqualify' then
    if v_a.ledger_id is not null then
      perform public.reverse_grant(v_a.ledger_id, p_actor, p_reason);
    end if;
    update public.attendance_records
      set qualified = false, reward_points = 0, ledger_id = null
      where id = p_attendance_id;

  else
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;

  insert into public.attendance_audit_events (
    attendance_id, action, actor_id, reason, metadata
  ) values (
    p_attendance_id, 'admin_correction', p_actor, p_reason,
    jsonb_build_object('action', p_action, 'checked_out_at', p_checked_out_at)
  );

  insert into public.audit_log (actor_auth_id, action, target_type, target_id, reason, before, after)
  values (
    p_actor, 'attendance.correct', 'attendance', p_attendance_id::text, p_reason,
    jsonb_build_object(
      'state', v_a.state, 'qualified', v_a.qualified, 'checked_out_at', v_a.checked_out_at
    ),
    jsonb_build_object('action', p_action, 'checked_out_at', p_checked_out_at)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Public projections (deliberately narrow; never serialize a whole row)
-- ---------------------------------------------------------------------------
create or replace view public.public_profiles
with (security_invoker = false) as
select
  mp.profile_slug as slug,
  case when mp.show_display_name then mp.display_name end as display_name,
  case when mp.show_photo then mp.photo_path end as photo_path,
  case when mp.show_about then mp.about end as about,
  case when mp.show_links then mp.links else '[]'::jsonb end as links,
  case when mp.show_member_number then m.public_number end as member_number,
  case when mp.show_member_since then m.member_since end as member_since,
  case when mp.show_points then coalesce(pb.points, 0) end as points,
  case when mp.show_stars then coalesce(sb.stars, 0) end as stars,
  case when mp.show_events then coalesce(ev.attended, 0) end as attended_events,
  case when mp.show_email then priv.email end as email,
  m.created_at
from public.member_profiles mp
join public.members m on m.id = mp.member_id
join public.member_private priv on priv.member_id = m.id
left join (
  select member_id, sum(delta)::int as points from public.point_ledger group by member_id
) pb on pb.member_id = m.id
left join (
  select member_id, sum(delta)::int as stars from public.star_ledger group by member_id
) sb on sb.member_id = m.id
left join (
  select a.member_id, count(distinct es.event_id)::int as attended
  from public.attendance_records a
  join public.event_sessions es on es.id = a.session_id
  where a.state = 'completed' and a.qualified
  group by a.member_id
) ev on ev.member_id = m.id
where mp.public_profile = true and m.status = 'active';

comment on view public.public_profiles is
  'Anonymous public projection. Columns are nulled out per member visibility toggles; internal ids and email are never included unless opted in.';

grant select on public.public_profiles to anon, authenticated;

create or replace view public.leaderboard
with (security_invoker = false) as
select
  row_number() over (
    order by coalesce(pb.points, 0) desc, mp.display_name asc, mp.profile_slug asc
  )::int as rank,
  mp.profile_slug as slug,
  mp.display_name,
  case when mp.show_photo then mp.photo_path end as photo_path,
  case when mp.show_member_number then m.public_number end as member_number,
  coalesce(pb.points, 0) as points
from public.member_profiles mp
join public.members m on m.id = mp.member_id
left join (
  select member_id, sum(delta)::int as points from public.point_ledger group by member_id
) pb on pb.member_id = m.id
where mp.public_profile = true
  and mp.show_points = true
  and mp.show_on_leaderboard = true
  and mp.show_display_name = true
  and m.status = 'active';

grant select on public.leaderboard to anon, authenticated;

create or replace view public.member_balances
with (security_invoker = true) as
select
  m.id as member_id,
  coalesce((select sum(pl.delta) from public.point_ledger pl where pl.member_id = m.id), 0)::int as points,
  coalesce((select sum(sl.delta) from public.star_ledger sl where sl.member_id = m.id), 0)::int as stars
from public.members m;

grant select on public.member_balances to authenticated;

-- Only these functions are callable by the server role; never by members.
revoke all on function public.grant_points(uuid, integer, text, text, text, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.reverse_grant(bigint, uuid, text) from public;
revoke all on function public.redeem_reward(uuid, uuid, integer, text) from public;
revoke all on function public.decide_redemption(uuid, text, uuid, text) from public;
revoke all on function public.prepare_card(uuid, text, text, uuid) from public;
revoke all on function public.activate_card(uuid, uuid) from public;
revoke all on function public.revoke_card(uuid, uuid, text) from public;
revoke all on function public.queue_write_job(uuid, uuid, text, text, integer, uuid) from public;
revoke all on function public.claim_write_job(uuid, text) from public;
revoke all on function public.complete_write_job(uuid, uuid, text, boolean, text, integer, uuid) from public;
revoke all on function public.complete_member_setup(uuid, text, text, text, text, text, text, jsonb) from public;
revoke all on function public.confirm_scan(uuid, text, uuid, text, text) from public;
revoke all on function public.correct_attendance(uuid, text, timestamptz, text, uuid) from public;
revoke all on function public.log_audit(uuid, text, text, text, text, jsonb, jsonb, text) from public;

grant execute on function public.grant_points(uuid, integer, text, text, text, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.reverse_grant(bigint, uuid, text) to service_role;
grant execute on function public.redeem_reward(uuid, uuid, integer, text) to service_role;
grant execute on function public.decide_redemption(uuid, text, uuid, text) to service_role;
grant execute on function public.prepare_card(uuid, text, text, uuid) to service_role;
grant execute on function public.activate_card(uuid, uuid) to service_role;
grant execute on function public.revoke_card(uuid, uuid, text) to service_role;
grant execute on function public.queue_write_job(uuid, uuid, text, text, integer, uuid) to service_role;
grant execute on function public.claim_write_job(uuid, text) to service_role;
grant execute on function public.complete_write_job(uuid, uuid, text, boolean, text, integer, uuid) to service_role;
grant execute on function public.complete_member_setup(uuid, text, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.confirm_scan(uuid, text, uuid, text, text) to service_role;
grant execute on function public.correct_attendance(uuid, text, timestamptz, text, uuid) to service_role;
grant execute on function public.log_audit(uuid, text, text, text, text, jsonb, jsonb, text) to service_role;
