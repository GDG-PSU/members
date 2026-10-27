-- ---------------------------------------------------------------------------
-- 0001 — Core schema for the GDG@PSU member system.
-- All application tables live in `public`. Auth users are owned by Supabase.
-- Instants are stored in UTC (timestamptz); event times are configured/rendered
-- in America/New_York by the application.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- Reusable updated_at trigger -------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create table public.user_roles (
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin')),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  note text check (char_length(note) <= 300),
  primary key (auth_user_id, role)
);

comment on table public.user_roles is
  'Server-assigned roles. Never writable by member clients; admin checks read revoked_at is null.';

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create table public.member_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and position('@' in email) > 1),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'expired', 'revoked')),
  paid_since date not null,
  note text check (char_length(note) <= 300),
  auth_user_id uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz
);

create unique index member_invitations_one_live_pending
  on public.member_invitations (email) where status = 'pending';
create index member_invitations_email_idx on public.member_invitations (email);
create index member_invitations_status_idx on public.member_invitations (status, created_at desc);

create trigger member_invitations_set_updated_at
  before update on public.member_invitations
  for each row execute function public.set_updated_at();

comment on table public.member_invitations is
  'No invitation tokens are stored here; Supabase Auth owns single-use invitation links.';

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
create table public.members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  public_number text not null unique
    check (public_number ~ '^GDG-[A-Z0-9]{6}$'),
  member_since date not null,
  invitation_id uuid unique references public.member_invitations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger members_set_updated_at
  before update on public.members
  for each row execute function public.set_updated_at();

-- Private/admin-only member data, never part of the public projection.
create table public.member_private (
  member_id uuid primary key references public.members (id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  admin_note text check (char_length(admin_note) <= 1000),
  updated_at timestamptz not null default now()
);

create trigger member_private_set_updated_at
  before update on public.member_private
  for each row execute function public.set_updated_at();

create index member_private_email_idx on public.member_private (email);

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.member_profiles (
  member_id uuid primary key references public.members (id) on delete cascade,
  profile_slug text not null unique
    check (profile_slug ~ '^[A-Za-z0-9_-]{22,64}$'),
  display_name text not null check (char_length(display_name) between 2 and 60),
  photo_path text not null check (char_length(photo_path) between 3 and 300),
  about text check (char_length(about) <= 280),
  links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 6),
  public_profile boolean not null default true,
  show_display_name boolean not null default true,
  show_photo boolean not null default true,
  show_about boolean not null default true,
  show_links boolean not null default true,
  show_member_number boolean not null default true,
  show_member_since boolean not null default true,
  show_points boolean not null default true,
  show_stars boolean not null default true,
  show_events boolean not null default true,
  show_on_leaderboard boolean not null default true,
  show_email boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger member_profiles_set_updated_at
  before update on public.member_profiles
  for each row execute function public.set_updated_at();

comment on column public.member_profiles.show_email is
  'Email is private by default; only shown when the member explicitly opts in.';

-- ---------------------------------------------------------------------------
-- Events and sessions
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  summary text not null default '' check (char_length(summary) <= 400),
  location text not null default '' check (char_length(location) <= 160),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'cancelled', 'completed')),
  is_public boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index events_status_starts_idx on public.events (status, starts_at);

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

create table public.event_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  kind text not null check (kind in ('main', 'bonus')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  check_in_opens_at timestamptz not null,
  check_in_closes_at timestamptz not null,
  check_out_opens_at timestamptz not null,
  check_out_closes_at timestamptz not null,
  minimum_duration_minutes integer not null default 0 check (minimum_duration_minutes between 0 and 1440),
  reward_points integer not null default 0 check (reward_points between 0 and 10000),
  is_enabled boolean not null default true,
  reward_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (check_out_closes_at > check_in_opens_at)
);

create unique index event_sessions_one_main
  on public.event_sessions (event_id) where kind = 'main';
create index event_sessions_event_idx on public.event_sessions (event_id);

create trigger event_sessions_set_updated_at
  before update on public.event_sessions
  for each row execute function public.set_updated_at();

comment on column public.event_sessions.reward_policy is
  'Immutable snapshot of the reward rule applied to a completed attendance.';

-- ---------------------------------------------------------------------------
-- Ledgers (append-only)
-- ---------------------------------------------------------------------------
create table public.point_ledger (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.members (id) on delete cascade,
  delta integer not null check (delta <> 0),
  kind text not null check (
    kind in (
      'attendance_reward',
      'interaction_reward',
      'redemption',
      'redemption_refund',
      'reversal',
      'admin_adjustment'
    )
  ),
  source_key text not null unique,
  description text not null check (char_length(description) between 1 and 300),
  actor_id uuid references auth.users (id) on delete set null,
  event_id uuid references public.events (id) on delete set null,
  session_id uuid references public.event_sessions (id) on delete set null,
  redemption_id uuid,
  rule_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index point_ledger_member_idx on public.point_ledger (member_id, created_at desc);

create table public.star_ledger (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.members (id) on delete cascade,
  delta integer not null check (delta <> 0),
  kind text not null check (
    kind in ('attendance_reward', 'interaction_reward', 'reversal', 'admin_adjustment')
  ),
  source_key text not null unique,
  point_ledger_id bigint references public.point_ledger (id) on delete set null,
  description text not null check (char_length(description) between 1 and 300),
  created_at timestamptz not null default now()
);

create index star_ledger_member_idx on public.star_ledger (member_id, created_at desc);

comment on table public.star_ledger is
  'Lifetime, non-spendable stars. Spends never write here; reversals mirror point reversals.';

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------
create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  session_id uuid not null references public.event_sessions (id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid references auth.users (id) on delete set null,
  checked_out_at timestamptz,
  checked_out_by uuid references auth.users (id) on delete set null,
  state text not null default 'checked_in'
    check (state in ('checked_in', 'completed', 'rejected')),
  duration_minutes integer check (duration_minutes is null or duration_minutes >= 0),
  qualified boolean not null default false,
  reward_points integer not null default 0 check (reward_points >= 0),
  ledger_id bigint references public.point_ledger (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, session_id)
);

create index attendance_records_session_idx on public.attendance_records (session_id, state);

create trigger attendance_records_set_updated_at
  before update on public.attendance_records
  for each row execute function public.set_updated_at();

create table public.attendance_audit_events (
  id bigint generated always as identity primary key,
  attendance_id uuid not null references public.attendance_records (id) on delete cascade,
  action text not null check (
    action in (
      'scan_received',
      'check_in_confirmed',
      'check_out_confirmed',
      'rejected',
      'admin_correction'
    )
  ),
  actor_id uuid references auth.users (id) on delete set null,
  device_id uuid,
  reason text check (char_length(reason) <= 300),
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index attendance_audit_attendance_idx
  on public.attendance_audit_events (attendance_id, created_at);

-- ---------------------------------------------------------------------------
-- Rewards and redemptions
-- ---------------------------------------------------------------------------
create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '' check (char_length(description) <= 300),
  cost_points integer not null check (cost_points between 1 and 10000),
  inventory integer check (inventory is null or inventory >= 0),
  is_active boolean not null default true,
  fulfillment_note text not null default '' check (char_length(fulfillment_note) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger rewards_set_updated_at
  before update on public.rewards
  for each row execute function public.set_updated_at();

create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  reward_id uuid not null references public.rewards (id) on delete restrict,
  reward_name_snapshot text not null,
  cost_points_snapshot integer not null check (cost_points_snapshot > 0),
  quantity integer not null default 1 check (quantity between 1 and 5),
  points_debited integer not null check (points_debited > 0),
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'fulfilled', 'cancelled', 'rejected')),
  idempotency_key text not null,
  reason text check (char_length(reason) <= 300),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, idempotency_key)
);

create index redemptions_member_idx on public.redemptions (member_id, created_at desc);
create index redemptions_status_idx on public.redemptions (status, created_at);

create trigger redemptions_set_updated_at
  before update on public.redemptions
  for each row execute function public.set_updated_at();

alter table public.point_ledger
  add constraint point_ledger_redemption_fk
  foreign key (redemption_id) references public.redemptions (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Card credentials and one-time write jobs
-- ---------------------------------------------------------------------------
create table public.card_credentials (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  token_hash text unique,
  token_ciphertext text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'revoked', 'lost', 'replaced')),
  issued_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text check (char_length(revoke_reason) <= 300),
  replaces_card_id uuid references public.card_credentials (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'pending' or token_hash is not null)
);

create unique index card_credentials_one_active
  on public.card_credentials (member_id) where status = 'active';
create index card_credentials_member_idx on public.card_credentials (member_id, created_at desc);

create trigger card_credentials_set_updated_at
  before update on public.card_credentials
  for each row execute function public.set_updated_at();

comment on table public.card_credentials is
  'Only a SHA-256 lookup hash and an encrypted copy (for authenticated display/write) are stored; plaintext tokens are never persisted or logged.';

create table public.card_write_jobs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null,
  member_id uuid not null references public.members (id) on delete cascade,
  card_id uuid not null references public.card_credentials (id) on delete cascade,
  payload_ciphertext text not null,
  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'written', 'failed', 'expired', 'cancelled')),
  nonce text not null unique,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0,
  failure_code text,
  result jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index card_write_jobs_device_idx on public.card_write_jobs (device_id, status);
create index card_write_jobs_expiry_idx on public.card_write_jobs (status, expires_at);

create trigger card_write_jobs_set_updated_at
  before update on public.card_write_jobs
  for each row execute function public.set_updated_at();

comment on column public.card_write_jobs.payload_ciphertext is
  'AES-256-GCM payload containing the card URL. Destroyed (overwritten) as soon as the job reaches a terminal state.';

-- ---------------------------------------------------------------------------
-- Devices, scans, audit log
-- ---------------------------------------------------------------------------
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique check (device_id ~ '^[a-z0-9][a-z0-9-]{2,31}$'),
  lane_label text not null check (char_length(lane_label) between 1 and 40),
  secret_hash text not null,
  status text not null default 'active' check (status in ('active', 'disabled', 'revoked')),
  mode text not null default 'kiosk' check (mode in ('kiosk', 'writer')),
  event_id uuid references public.events (id) on delete set null,
  session_id uuid references public.event_sessions (id) on delete set null,
  firmware_version text check (firmware_version is null or char_length(firmware_version) <= 40),
  last_seen_at timestamptz,
  last_ip_hint text check (last_ip_hint is null or char_length(last_ip_hint) <= 64),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger devices_set_updated_at
  before update on public.devices
  for each row execute function public.set_updated_at();

comment on table public.devices is
  'Device credentials are independent of user identity and store only a hashed verifier.';

alter table public.card_write_jobs
  add constraint card_write_jobs_device_fk
  foreign key (device_id) references public.devices (id) on delete cascade;

create table public.device_scans (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  card_id uuid references public.card_credentials (id) on delete set null,
  session_id uuid references public.event_sessions (id) on delete set null,
  action text not null default 'check_in'
    check (action in ('check_in', 'check_out', 'unknown')),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected', 'expired')),
  idempotency_key text not null,
  expires_at timestamptz not null default (now() + interval '3 minutes'),
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (device_id, idempotency_key)
);

create index device_scans_pending_idx
  on public.device_scans (status, created_at desc);
create index device_scans_member_idx on public.device_scans (member_id, created_at desc);

comment on table public.device_scans is
  'A scan only queues intent. Attendance and points change exclusively through an admin-confirmed transaction.';

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_auth_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 3 and 80),
  target_type text not null check (char_length(target_type) between 2 and 40),
  target_id text,
  reason text check (char_length(reason) <= 300),
  before jsonb,
  after jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_action_idx on public.audit_log (action, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.auth_user_id = uid
      and ur.role = 'admin'
      and ur.revoked_at is null
  );
$$;

create or replace function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.members m
  where m.auth_user_id = auth.uid()
    and m.status = 'active';
$$;

grant execute on function public.is_admin(uuid) to anon, authenticated, service_role;
grant execute on function public.current_member_id() to authenticated, service_role;

-- Append-only guards -----------------------------------------------------------
create or replace function public.prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'append_only_relation' using errcode = 'P0001';
end;
$$;

create trigger point_ledger_append_only
  before update or delete on public.point_ledger
  for each row execute function public.prevent_mutation();

create trigger star_ledger_append_only
  before update or delete on public.star_ledger
  for each row execute function public.prevent_mutation();

create trigger attendance_audit_append_only
  before update or delete on public.attendance_audit_events
  for each row execute function public.prevent_mutation();

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.prevent_mutation();
