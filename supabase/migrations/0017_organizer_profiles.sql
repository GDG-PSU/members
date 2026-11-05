-- Organizers carry an NFC card too, so they need a public profile for it to open.
--
-- A profile and a card both hang off public.members. Rather than build a second
-- profile system, a staff account now gets a members row of kind 'organizer'. It
-- is a profile and a card holder only: it never earns or spends points, never
-- has attendance, and never appears on the leaderboard. An account is still
-- exactly one of member, admin or superadmin; what changes is that staff are no
-- longer profile-less, and promoting a member no longer deletes their profile.

alter table public.members
  add column kind text not null default 'member'
    check (kind in ('member', 'organizer'));

comment on column public.members.kind is
  'member: a paying member with points and attendance. organizer: a staff account''s profile and card holder, with neither.';

-- A member's photo is how the kiosk checks who is standing there. An organizer is
-- never checked in, so theirs is optional, which also lets existing staff start
-- with a placeholder profile.
alter table public.member_profiles
  alter column photo_path drop not null;

create function public.require_member_photo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.photo_path is null and exists (
    select 1 from public.members m where m.id = new.member_id and m.kind = 'member'
  ) then
    raise exception 'photo_required' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger member_profiles_require_member_photo
  before insert or update of photo_path on public.member_profiles
  for each row execute function public.require_member_photo();

-- Points, stars, attendance and reward requests belong to members only. Enforced
-- on the tables so no code path, present or future, can give them to an organizer.
create function public.reject_organizer_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.members m where m.id = new.member_id and m.kind = 'organizer'
  ) then
    raise exception 'organizer_has_no_member_activity' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger point_ledger_members_only
  before insert on public.point_ledger
  for each row execute function public.reject_organizer_activity();
create trigger star_ledger_members_only
  before insert on public.star_ledger
  for each row execute function public.reject_organizer_activity();
create trigger attendance_records_members_only
  before insert on public.attendance_records
  for each row execute function public.reject_organizer_activity();
create trigger redemptions_members_only
  before insert on public.redemptions
  for each row execute function public.reject_organizer_activity();

revoke all on function public.require_member_photo() from public, anon, authenticated;
revoke all on function public.reject_organizer_activity() from public, anon, authenticated;

-- The public projection says who is an organizer, and never shows member-only
-- numbers for one. A profile without a photo offers none.
create or replace view public.public_profiles with (security_invoker = false) as
select mp.profile_slug as slug,
  case when mp.show_display_name then mp.display_name end as display_name,
  case when mp.show_photo and mp.photo_path is not null then mp.profile_slug end as photo_path,
  case when mp.show_about then mp.about end as about,
  case when mp.show_links then mp.links else '[]'::jsonb end as links,
  case when mp.show_member_number and m.kind = 'member' then m.public_number end as member_number,
  case when mp.show_member_since and m.kind = 'member' then m.member_since end as member_since,
  case when mp.show_points and m.kind = 'member' then coalesce(pb.points, 0) end as points,
  case when mp.show_stars and m.kind = 'member' then coalesce(sb.stars, 0) end as stars,
  case when mp.show_events and m.kind = 'member' then coalesce(ev.attended, 0) end as attended_events,
  case when mp.show_email then priv.email end as email, m.created_at,
  m.kind
from public.member_profiles mp
join public.members m on m.id = mp.member_id
join public.member_private priv on priv.member_id = m.id
left join (select member_id, sum(delta)::int as points from public.point_ledger group by member_id) pb on pb.member_id = m.id
left join (select member_id, sum(delta)::int as stars from public.star_ledger group by member_id) sb on sb.member_id = m.id
left join (select a.member_id, count(distinct es.event_id)::int as attended
  from public.attendance_records a join public.event_sessions es on es.id = a.session_id
  where a.state = 'completed' group by a.member_id) ev on ev.member_id = m.id
where mp.public_profile = true and m.status = 'active';

create or replace view public.leaderboard with (security_invoker = false) as
select row_number() over (order by coalesce(sb.stars, 0) desc, mp.display_name asc, mp.profile_slug asc)::int as rank,
  mp.profile_slug as slug, mp.display_name,
  case when mp.show_photo then mp.profile_slug end as photo_path,
  case when mp.show_member_number then m.public_number end as member_number,
  coalesce(sb.stars, 0) as stars
from public.member_profiles mp join public.members m on m.id = mp.member_id
left join (select member_id, sum(delta)::int as stars from public.star_ledger group by member_id) sb on sb.member_id = m.id
where mp.public_profile = true and mp.show_stars = true and mp.show_on_leaderboard = true
  and mp.show_display_name = true and m.status = 'active' and m.kind = 'member';

revoke all on public.public_profiles, public.leaderboard from public, anon, authenticated;
grant select on public.public_profiles, public.leaderboard to service_role;

-- A new staff account's own profile, created once after they have set a password
-- and an authenticator.
create function public.complete_staff_profile(
  p_auth_user_id uuid,
  p_profile_slug text,
  p_public_number text,
  p_display_name text,
  p_photo_path text,
  p_about text,
  p_show_email boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_since timestamptz;
  v_member_id uuid;
  v_kind text;
begin
  select min(granted_at) into v_since
  from public.user_roles
  where auth_user_id = p_auth_user_id
    and revoked_at is null
    and role in ('admin', 'superadmin');
  if v_since is null then
    raise exception 'not_staff' using errcode = 'P0001';
  end if;

  select id, kind into v_member_id, v_kind
  from public.members
  where auth_user_id = p_auth_user_id
  for update;
  if v_member_id is not null then
    if v_kind <> 'organizer' then
      raise exception 'profile_exists' using errcode = 'P0001';
    end if;
    -- Staff whose access was revoked and later restored still have their old,
    -- switched-off profile. It is brought back rather than duplicated.
    update public.members set status = 'active' where id = v_member_id;
    update public.member_profiles
    set display_name = p_display_name,
        photo_path = coalesce(p_photo_path, photo_path),
        about = nullif(p_about, ''),
        show_email = coalesce(p_show_email, false),
        public_profile = true
    where member_id = v_member_id;
    return v_member_id;
  end if;

  select lower(email) into v_email from auth.users where id = p_auth_user_id;
  if v_email is null then
    raise exception 'auth_user_not_found' using errcode = 'P0001';
  end if;

  insert into public.members (auth_user_id, kind, public_number, member_since)
  values (p_auth_user_id, 'organizer', p_public_number, v_since::date)
  returning id into v_member_id;

  insert into public.member_private (member_id, email)
  values (v_member_id, v_email);

  insert into public.member_profiles (
    member_id, profile_slug, display_name, photo_path, about,
    public_profile, show_email, show_points, show_stars, show_events,
    show_on_leaderboard, show_member_number, show_member_since
  ) values (
    v_member_id, p_profile_slug, p_display_name, p_photo_path, nullif(p_about, ''),
    true, coalesce(p_show_email, false), false, false, false,
    false, false, false
  );

  insert into public.audit_log (actor_auth_id, action, target_type, target_id)
  values (p_auth_user_id, 'staff.profile_created', 'member', v_member_id::text);

  return v_member_id;
end;
$$;

revoke all on function public.complete_staff_profile(uuid, text, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.complete_staff_profile(uuid, text, text, text, text, text, boolean)
  to service_role;

-- Changing a user's type keeps their profile and card where it can.
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
  v_member public.members;
  v_has_photo boolean;
  v_invitation_id uuid;
  v_history_removed boolean := false;
  v_profile_removed boolean := false;
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

  select * into v_member
  from public.members
  where auth_user_id = p_auth_user_id
  for update;

  if p_role in ('admin', 'superadmin') then
    -- Runs before any erasure flag is set, so the last-superadmin guard still
    -- applies to this update.
    update public.user_roles
    set revoked_at = now(), revoked_by = p_actor
    where auth_user_id = p_auth_user_id
      and revoked_at is null
      and role <> p_role;

    if v_member.id is not null then
      if v_member.kind = 'member' then
        -- Staff confirm attendance and award points, so they hold none of their
        -- own. The profile and the card stay. The flag lets the append-only
        -- guards accept these deletes; audit_log intentionally survives.
        perform set_config('app.member_erasure', 'on', true);
        delete from public.star_ledger where member_id = v_member.id;
        delete from public.attendance_records where member_id = v_member.id;
        delete from public.device_scans where member_id = v_member.id;
        delete from public.point_ledger where member_id = v_member.id;
        delete from public.redemptions where member_id = v_member.id;
        perform set_config('app.member_erasure', 'off', true);
        v_history_removed := true;

        update public.member_profiles
        set show_points = false, show_stars = false, show_events = false,
            show_on_leaderboard = false, show_member_number = false, show_member_since = false
        where member_id = v_member.id;
      end if;

      update public.members
      set kind = 'organizer', status = 'active'
      where id = v_member.id;
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
      'history_removed', v_history_removed,
      'profile_removed', false,
      'invitation_id', null,
      'member_id', v_member.id
    );
  end if;

  -- Member: remove every staff role first.
  update public.user_roles
  set revoked_at = now(), revoked_by = p_actor
  where auth_user_id = p_auth_user_id
    and revoked_at is null;

  if v_member.id is not null and v_member.kind = 'member' then
    -- Already a member. Their status is left alone: lifting a suspension is a
    -- separate, reasoned action.
    return jsonb_build_object(
      'role', 'member',
      'history_removed', false,
      'profile_removed', false,
      'invitation_id', null,
      'member_id', v_member.id
    );
  end if;

  if v_member.id is not null then
    select photo_path is not null into v_has_photo
    from public.member_profiles
    where member_id = v_member.id;

    if coalesce(v_has_photo, false) then
      -- The organizer profile already has what a member needs, so it simply
      -- becomes a member's, card included.
      update public.members
      set kind = 'member', status = 'active', member_since = coalesce(p_paid_since, current_date)
      where id = v_member.id;

      update public.member_profiles
      set show_points = true, show_stars = true, show_events = true,
          show_on_leaderboard = true, show_member_number = true, show_member_since = true
      where member_id = v_member.id;

      return jsonb_build_object(
        'role', 'member',
        'history_removed', false,
        'profile_removed', false,
        'invitation_id', null,
        'member_id', v_member.id
      );
    end if;

    -- A member must have a face photo for the kiosk. A profile without one is
    -- removed, and the account sets up a member profile the usual way.
    perform set_config('app.member_erasure', 'on', true);
    delete from public.members where id = v_member.id;
    perform set_config('app.member_erasure', 'off', true);
    v_profile_removed := true;
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
    'history_removed', false,
    'profile_removed', v_profile_removed,
    'invitation_id', v_invitation_id,
    'member_id', null
  );
end;
$$;
