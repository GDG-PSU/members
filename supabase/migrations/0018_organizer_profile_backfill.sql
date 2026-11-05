-- Placeholder profiles for the staff accounts that exist today.
--
-- Kept apart from 0017 on purpose. 0017 only adds things the running app can
-- ignore, so it is safe to apply before the new app is live. These rows are
-- different: an app that does not know about organizers would treat them as
-- members and send staff to the member dashboard. This migration therefore ships
-- in the same push as the app code that understands them.
--
-- Each account gets its email ID as the name, no photo, and nothing but the name
-- shown publicly. An account that already has a profile is left alone, so
-- running this again changes nothing.

do $$
declare
  v_staff record;
  v_member_id uuid;
  v_number text;
  v_name text;
begin
  for v_staff in
    select u.id as auth_user_id, lower(u.email) as email, min(r.granted_at) as since
    from public.user_roles r
    join auth.users u on u.id = r.auth_user_id
    where r.revoked_at is null
      and r.role in ('admin', 'superadmin')
      and u.email is not null
      and not exists (select 1 from public.members m where m.auth_user_id = u.id)
    group by u.id, u.email
  loop
    loop
      v_number := 'GDG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      exit when not exists (select 1 from public.members where public_number = v_number);
    end loop;

    v_name := left(split_part(v_staff.email, '@', 1), 60);
    if char_length(v_name) < 2 then
      v_name := 'Organizer';
    end if;

    insert into public.members (auth_user_id, kind, public_number, member_since)
    values (v_staff.auth_user_id, 'organizer', v_number, v_staff.since::date)
    returning id into v_member_id;

    insert into public.member_private (member_id, email)
    values (v_member_id, v_staff.email);

    insert into public.member_profiles (
      member_id, profile_slug, display_name, photo_path,
      public_profile, show_email, show_points, show_stars, show_events,
      show_on_leaderboard, show_member_number, show_member_since
    ) values (
      v_member_id, substr(replace(gen_random_uuid()::text, '-', ''), 1, 24), v_name, null,
      true, false, false, false, false,
      false, false, false
    );
  end loop;
end;
$$;
