-- Local-development fixtures only. Never run against production.
-- Members are created by scripts/db-seed.mjs after `supabase start` because
-- they require Auth users; this file seeds safe catalogue data.

insert into public.rewards (name, description, cost_points, inventory)
select 'Sticker pack', 'Fictional local fixture.', 10, 25
where not exists (select 1 from public.rewards where name = 'Sticker pack');

insert into public.rewards (name, description, cost_points, inventory)
select 'Mug', 'Fictional local fixture.', 30, 5
where not exists (select 1 from public.rewards where name = 'Mug');

insert into public.events (name, slug, summary, location, starts_at, ends_at, status)
select 'Demo Build Night', 'demo-build-night', 'Fictional local fixture.', 'Demo Hall',
       now() + interval '3 days', now() + interval '3 days 3 hours', 'published'
where not exists (select 1 from public.events where slug = 'demo-build-night');

insert into public.event_sessions (
  event_id, name, kind, starts_at, ends_at, check_in_opens_at, check_in_closes_at,
  check_out_opens_at, check_out_closes_at, minimum_duration_minutes, reward_points
)
select e.id, 'Main session', 'main', e.starts_at, e.ends_at,
       e.starts_at - interval '30 minutes', e.starts_at + interval '1 hour',
       e.starts_at, e.ends_at, 30, 10
from public.events e
where e.slug = 'demo-build-night'
  and not exists (select 1 from public.event_sessions s where s.event_id = e.id and s.kind = 'main');
