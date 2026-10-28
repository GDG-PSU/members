-- Only new profiles receive the new default. Existing choices are preserved.
alter table public.member_profiles alter column show_email set default true;
comment on column public.member_profiles.show_email is
  'Email is public by default and can be hidden by the member during setup or later.';

-- Activation and its privacy choices commit together. Only the trusted server may
-- call either function; no intermediate public profile can be observed.
create function public.complete_member_setup_with_privacy(
  p_auth_user_id uuid, p_email text, p_display_name text, p_profile_slug text,
  p_photo_path text, p_public_number text, p_about text, p_links jsonb,
  p_public_profile boolean, p_show_email boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_existing uuid;
  v_member uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_auth_user_id::text, 0));
  select id into v_existing from public.members where auth_user_id = p_auth_user_id;
  if v_existing is not null then return v_existing; end if;
  if p_public_profile is null or p_show_email is null then
    raise exception 'invalid_privacy_settings';
  end if;
  v_member := public.complete_member_setup(p_auth_user_id, p_email, p_display_name,
    p_profile_slug, p_photo_path, p_public_number, p_about, p_links);
  update public.member_profiles set public_profile = p_public_profile,
    show_email = p_show_email where member_id = v_member;
  return v_member;
end;
$$;
revoke all on function public.complete_member_setup_with_privacy(uuid,text,text,text,text,text,text,jsonb,boolean,boolean) from public, anon, authenticated;
grant execute on function public.complete_member_setup_with_privacy(uuid,text,text,text,text,text,text,jsonb,boolean,boolean) to service_role;

-- Previously issued public storage URLs must stop serving photos immediately.
update storage.buckets set public = false where id = 'avatars';
drop policy if exists "avatars are publicly readable" on storage.objects;

-- Do not expose storage paths (which include the auth user ID) via public views.
create or replace view public.public_profiles with (security_invoker = false) as
select mp.profile_slug as slug,
  case when mp.show_display_name then mp.display_name end as display_name,
  case when mp.show_photo then mp.profile_slug end as photo_path,
  case when mp.show_about then mp.about end as about,
  case when mp.show_links then mp.links else '[]'::jsonb end as links,
  case when mp.show_member_number then m.public_number end as member_number,
  case when mp.show_member_since then m.member_since end as member_since,
  case when mp.show_points then coalesce(pb.points, 0) end as points,
  case when mp.show_stars then coalesce(sb.stars, 0) end as stars,
  case when mp.show_events then coalesce(ev.attended, 0) end as attended_events,
  case when mp.show_email then priv.email end as email, m.created_at
from public.member_profiles mp
join public.members m on m.id = mp.member_id
join public.member_private priv on priv.member_id = m.id
left join (select member_id, sum(delta)::int as points from public.point_ledger group by member_id) pb on pb.member_id = m.id
left join (select member_id, sum(delta)::int as stars from public.star_ledger group by member_id) sb on sb.member_id = m.id
left join (select a.member_id, count(distinct es.event_id)::int as attended
  from public.attendance_records a join public.event_sessions es on es.id = a.session_id
  where a.state = 'completed' group by a.member_id) ev on ev.member_id = m.id
where mp.public_profile = true and m.status = 'active';
comment on view public.public_profiles is
  'Public projection: email and photos are subject to member visibility; photo_path contains only the public profile slug.';

create or replace view public.leaderboard with (security_invoker = false) as
select row_number() over (order by coalesce(pb.points, 0) desc, mp.display_name asc, mp.profile_slug asc)::int as rank,
  mp.profile_slug as slug, mp.display_name,
  case when mp.show_photo then mp.profile_slug end as photo_path,
  case when mp.show_member_number then m.public_number end as member_number,
  coalesce(pb.points, 0) as points
from public.member_profiles mp join public.members m on m.id = mp.member_id
left join (select member_id, sum(delta)::int as points from public.point_ledger group by member_id) pb on pb.member_id = m.id
where mp.public_profile = true and mp.show_points = true and mp.show_on_leaderboard = true
  and mp.show_display_name = true and m.status = 'active';
