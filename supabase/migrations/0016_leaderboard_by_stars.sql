-- The leaderboard ranked members by spendable points, so redeeming a reward
-- pushed a member down the board. Stars are the lifetime total and never fall
-- when points are spent, which is what a ranking is meant to show.
--
-- A member now appears when they share their stars, since that is the number on
-- display; before, it was their points.

drop view public.leaderboard;

create view public.leaderboard with (security_invoker = false) as
select row_number() over (order by coalesce(sb.stars, 0) desc, mp.display_name asc, mp.profile_slug asc)::int as rank,
  mp.profile_slug as slug, mp.display_name,
  case when mp.show_photo then mp.profile_slug end as photo_path,
  case when mp.show_member_number then m.public_number end as member_number,
  coalesce(sb.stars, 0) as stars
from public.member_profiles mp join public.members m on m.id = mp.member_id
left join (select member_id, sum(delta)::int as stars from public.star_ledger group by member_id) sb on sb.member_id = m.id
where mp.public_profile = true and mp.show_stars = true and mp.show_on_leaderboard = true
  and mp.show_display_name = true and m.status = 'active';

comment on view public.leaderboard is
  'Opted-in public ranking by lifetime stars. Read by the server only, never by an API role.';

-- A recreated view starts with default privileges, so close it again explicitly.
revoke all on public.leaderboard from public, anon, authenticated;
grant select on public.leaderboard to service_role;
