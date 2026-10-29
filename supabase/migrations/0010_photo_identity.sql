-- ---------------------------------------------------------------------------
-- 0010 — Photo identity window.
-- The profile photo is the identity anchor at the kiosk. When it changes, the
-- member must show a PSU ID at the next attendance confirmation, so the server
-- needs to know when the current photo was uploaded (not just when the profile
-- row was last touched).
-- ---------------------------------------------------------------------------

alter table public.member_profiles
  add column if not exists photo_changed_at timestamptz;

-- Existing rows: the last profile update is the best available approximation.
update public.member_profiles
  set photo_changed_at = updated_at
  where photo_changed_at is null;

alter table public.member_profiles
  alter column photo_changed_at set default now();

alter table public.member_profiles
  alter column photo_changed_at set not null;

comment on column public.member_profiles.photo_changed_at is
  'When the current profile photo was uploaded. A change inside 48 hours requires a PSU ID check at the kiosk before attendance is confirmed.';

-- Keep the timestamp correct even if an application path forgets to set it.
create or replace function public.set_photo_changed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.photo_path is distinct from old.photo_path then
    new.photo_changed_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists member_profiles_photo_changed on public.member_profiles;
create trigger member_profiles_photo_changed
  before update on public.member_profiles
  for each row execute function public.set_photo_changed_at();
