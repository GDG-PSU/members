-- ---------------------------------------------------------------------------
-- 0020 — Sign-in links the app owns.
--
-- Invitation and password reset links used to carry a Supabase Auth token, so
-- they lived exactly as long as the project's OTP window, which cannot be set
-- above 24 hours. An invitation is often opened days later.
--
-- A link now carries a random token of our own. Only its SHA-256 hash is stored,
-- with the person it is for, what it is for, and when it stops working. When the
-- person presses Continue the server redeems it here and only then asks Supabase
-- for a session, so the lifetime is ours to set: 72 hours for an invitation and
-- 48 hours for a password reset.
-- ---------------------------------------------------------------------------

create table public.sign_in_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (char_length(token_hash) = 64),
  purpose text not null check (purpose in ('member_invite', 'staff_invite', 'recovery')),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  -- A ceiling the app cannot exceed by mistake.
  check (expires_at > created_at and expires_at <= created_at + interval '72 hours')
);

create index sign_in_links_user_idx on public.sign_in_links (auth_user_id, created_at desc);

comment on table public.sign_in_links is
  'One-time invitation and password reset links. Holds the hash of the token, never the token or the link.';

-- No policies: only the server reads or writes this table.
alter table public.sign_in_links enable row level security;
revoke all on public.sign_in_links from anon, authenticated;

create function public.issue_sign_in_link(
  p_token_hash text,
  p_purpose text,
  p_auth_user_id uuid,
  p_hours integer,
  p_created_by uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires_at timestamptz;
begin
  if p_hours is null or p_hours < 1 or p_hours > 72 then
    raise exception 'link_lifetime_out_of_range' using errcode = 'P0001';
  end if;
  v_expires_at := now() + make_interval(hours => p_hours);

  -- One link per person. A new one replaces whatever was sent before, so a lost
  -- or forwarded link stops working as soon as it is replaced.
  delete from public.sign_in_links where auth_user_id = p_auth_user_id;

  insert into public.sign_in_links (token_hash, purpose, auth_user_id, created_by, expires_at)
  values (p_token_hash, p_purpose, p_auth_user_id, p_created_by, v_expires_at);

  return v_expires_at;
end;
$$;

comment on function public.issue_sign_in_link(text, text, uuid, integer, uuid) is
  'Stores a new one-time link for a person and removes their earlier ones.';

-- One statement, so two people pressing Continue at once cannot both win.
create function public.redeem_sign_in_link(p_token_hash text)
returns table (link_id uuid, auth_user_id uuid, purpose text)
language sql
security definer
set search_path = ''
as $$
  update public.sign_in_links l
  set used_at = now()
  where l.token_hash = p_token_hash
    and l.used_at is null
    and l.expires_at > now()
  returning l.id, l.auth_user_id, l.purpose;
$$;

comment on function public.redeem_sign_in_link(text) is
  'Spends a one-time link if it is unused and unexpired, returning who it is for. Returns nothing otherwise.';

revoke all on function public.issue_sign_in_link(text, text, uuid, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.redeem_sign_in_link(text) from public, anon, authenticated;
grant execute on function public.issue_sign_in_link(text, text, uuid, integer, uuid) to service_role;
grant execute on function public.redeem_sign_in_link(text) to service_role;

-- An invitation is open for as long as its link works.
alter table public.member_invitations
  alter column expires_at set default (now() + interval '72 hours');
