-- ---------------------------------------------------------------------------
-- 0014 — Close the RPC privilege hole and harden domain transitions.
--
-- Supabase's default ACL grants EXECUTE on new public functions directly to
-- anon and authenticated, so the `revoke ... from public` statements in earlier
-- migrations removed nothing: every privileged SECURITY DEFINER function was
-- callable through /rest/v1/rpc with only the publishable key. The grants at the
-- end of this file are the fix; they run last so they also cover the functions
-- created here.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Last superadmin: enforced on the table so every write path is covered.
-- ---------------------------------------------------------------------------
create function public.guard_last_superadmin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'superadmin'
    and old.revoked_at is null
    and (tg_op = 'DELETE' or new.revoked_at is not null or new.role <> 'superadmin')
    -- A reviewed account erasure is an operator decision, recoverable with the
    -- bootstrap script.
    and coalesce(current_setting('app.member_erasure', true), 'off') <> 'on'
  then
    -- Serializes concurrent removals: two superadmins revoking each other must
    -- not both see the other as the remaining one.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('user_roles:superadmin', 0));
    if not exists (
      select 1 from public.user_roles ur
      where ur.role = 'superadmin'
        and ur.revoked_at is null
        and ur.auth_user_id <> old.auth_user_id
    ) then
      raise exception 'last_superadmin' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger user_roles_keep_last_superadmin
  before update or delete on public.user_roles
  for each row execute function public.guard_last_superadmin();

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

  if p_role in ('admin', 'superadmin') then
    -- Runs before the erasure flag below is set, so the last-superadmin guard
    -- still applies to this update.
    update public.user_roles
    set revoked_at = now(), revoked_by = p_actor
    where auth_user_id = p_auth_user_id
      and revoked_at is null
      and role <> p_role;

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

-- ---------------------------------------------------------------------------
-- Member setup: an invitation binds to its account, and staff stay staff.
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

  if exists (
    select 1 from public.user_roles ur
    where ur.auth_user_id = p_auth_user_id and ur.revoked_at is null
  ) then
    raise exception 'user_is_staff' using errcode = 'P0001';
  end if;

  select * into v_invitation
  from public.member_invitations
  where email = lower(p_email) and status = 'pending'
  order by created_at desc
  limit 1
  for update;

  if not found
    or (v_invitation.auth_user_id is not null and v_invitation.auth_user_id <> p_auth_user_id)
  then
    raise exception 'invitation_not_found' using errcode = 'P0001';
  end if;
  if v_invitation.expires_at < now() then
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
-- Points and redemptions
-- ---------------------------------------------------------------------------
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
  select * into v_orig from public.point_ledger where id = p_ledger_id;
  if not found then
    raise exception 'ledger_entry_not_found' using errcode = 'P0001';
  end if;
  if v_orig.delta <= 0 or v_orig.kind in ('redemption', 'redemption_refund', 'reversal') then
    raise exception 'only_positive_grants_are_reversible' using errcode = 'P0001';
  end if;
  if p_reason is null or char_length(p_reason) < 3 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  -- A retry returns the earlier reversal even if the balance has moved since.
  select id into v_new from public.point_ledger where source_key = 'reversal:' || p_ledger_id;
  if v_new is not null then
    return v_new;
  end if;

  -- The same lock redeem_reward takes, so a concurrent spend cannot race this
  -- balance check into a negative balance.
  perform 1 from public.members where id = v_orig.member_id for update;

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

  -- A concurrent retry may have committed while this call waited for the lock.
  select id into v_redemption_id
  from public.redemptions
  where member_id = p_member_id and idempotency_key = p_idempotency_key;
  if v_redemption_id is not null then
    return v_redemption_id;
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

-- ---------------------------------------------------------------------------
-- Cards: the working card survives until its replacement is verified.
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

  -- Only an unwritten card is superseded here. Replacing the active card waits
  -- for activate_card, so an abandoned or failed write never strands the member.
  -- A lost card is revoked explicitly with revoke_card.
  update public.card_credentials
    set status = 'replaced', revoked_at = now(), revoked_by = p_actor, revoke_reason = 'Superseded before activation'
    where member_id = p_member_id and status = 'pending';

  insert into public.card_credentials (
    member_id, token_hash, token_ciphertext, status, replaces_card_id, created_by
  ) values (
    p_member_id,
    p_token_hash,
    p_token_ciphertext,
    'pending',
    (
      select id from public.card_credentials
      where member_id = p_member_id and status = 'active'
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
  if v_card.status = 'active' then
    return;
  end if;
  if v_card.status <> 'pending' then
    raise exception 'card_not_activatable' using errcode = 'P0001';
  end if;

  update public.card_credentials
    set status = 'replaced', revoked_at = now(), revoked_by = p_actor, revoke_reason = 'Replaced by new card'
    where member_id = v_card.member_id and status = 'active' and id <> p_card_id;

  update public.card_credentials
    set status = 'active', issued_at = now()
    where id = p_card_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------

-- A ledger source key can only be used once, so after a grant is reversed the
-- next grant for the same attendance needs a new key. Unreversed grants keep
-- their key, which is what makes retries idempotent.
create function public.attendance_grant_key(p_attendance_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select 'attendance:' || p_attendance_id::text
    || case when reversed = 0 then '' else ':' || reversed::text end
  from (
    select count(*)::int as reversed
    from public.point_ledger g
    join public.point_ledger r on r.source_key = 'reversal:' || g.id
    where g.kind = 'attendance_reward'
      and (
        g.source_key = 'attendance:' || p_attendance_id::text
        or g.source_key like 'attendance:' || p_attendance_id::text || ':%'
      )
  ) counts;
$$;

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
        member_id, session_id, checked_in_at, checked_in_by, state
      ) values (
        v_scan.member_id, v_scan.session_id, now(), p_actor, 'checked_in'
      ) returning id into v_attendance_id;
    exception
      when unique_violation then
        raise exception 'duplicate_check_in' using errcode = 'P0001';
    end;

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
    if p_checked_out_at <= v_a.checked_in_at then
      raise exception 'checkout_before_check_in' using errcode = 'P0001';
    end if;
    v_duration := floor(extract(epoch from (p_checked_out_at - v_a.checked_in_at)) / 60)::int;
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
        public.attendance_grant_key(v_a.id),
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
-- Table and column privileges
-- ---------------------------------------------------------------------------

-- The app reads the public projections with the server-only client. Direct API
-- access would let anyone with the publishable key dump every opted-in email.
revoke select on public.public_profiles, public.leaderboard from anon, authenticated;
grant select on public.public_profiles, public.leaderboard to service_role;

revoke all on public.rate_limit_counters, public.device_request_nonces from anon, authenticated;

-- RLS selects rows, not columns. Organizer notes must not be readable by the
-- member they describe, and stored secrets are never needed through the API.
revoke select on public.member_private from authenticated;
grant select (member_id, email, updated_at) on public.member_private to authenticated;

revoke select on public.card_credentials from authenticated;
grant select (
  id, member_id, status, issued_at, revoked_at, revoked_by, revoke_reason, replaces_card_id,
  created_by, created_at, updated_at
) on public.card_credentials to authenticated;

revoke select on public.devices from authenticated;
grant select (
  id, device_id, lane_label, status, mode, event_id, session_id, firmware_version, last_seen_at,
  last_ip_hint, created_by, created_at, rotated_at, updated_at
) on public.devices to authenticated;

revoke select on public.card_write_jobs from authenticated;
grant select (
  id, device_id, member_id, card_id, status, expires_at, claimed_at, completed_at,
  attempt_count, failure_code, result, created_by, created_at, updated_at
) on public.card_write_jobs to authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
do $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (
        select 1 from pg_catalog.pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function);
    execute format('grant execute on function %s to service_role', v_function);
  end loop;
end;
$$;

-- RLS policies evaluate these as the querying role. They only ever describe the
-- caller, because each one checks auth.uid().
grant execute on function public.current_member_id() to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_superadmin(uuid) to authenticated;

-- New objects start closed; every migration must grant what it needs explicitly.
-- The schema-scoped statements can only remove the Supabase default ACL entries.
-- PostgreSQL's built-in PUBLIC execute grant has to be removed globally.
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges revoke execute on functions from public;
