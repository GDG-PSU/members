-- ---------------------------------------------------------------------------
-- 0021 — A stored key for each card reader.
--
-- A reader's key used to be worked out from a server secret and the reader's
-- ID, and reached the reader the first time an organizer plugged it in. It is
-- now a random key of the reader's own, put in when the reader is flashed and
-- kept here, so a freshly flashed reader works for every organizer straight
-- away and its key can be changed without touching any other reader.
--
-- The reader obeys only a session opened with this key, over its cable as well
-- as over Bluetooth, and the server answers that handshake only for a signed-in
-- organizer. The key is stored sealed with CARD_WRITE_ENCRYPTION_KEY, which the
-- database never holds.
--
-- A key change is two steps, because the reader and this table cannot change in
-- one transaction: the new version is stored first, then given to the reader,
-- and the older versions are removed only once the reader has proved it holds
-- the new one. Until then both work, so a change that is cut short locks
-- nobody out.
-- ---------------------------------------------------------------------------

create table public.reader_keys (
  device_id text not null check (device_id ~ '^esp32-[0-9a-f]{12}$'),
  version integer not null check (version > 0),
  sealed_key text not null check (sealed_key like 'v1.%'),
  created_at timestamptz not null default now(),
  -- Null when the key was put in by the flashing tool rather than a person.
  created_by uuid references auth.users (id) on delete set null,
  primary key (device_id, version)
);

comment on table public.reader_keys is
  'The key each card reader holds, sealed with a secret the database does not have. Never the key itself.';

-- No policies: only the server reads or writes this table.
alter table public.reader_keys enable row level security;
revoke all on public.reader_keys from anon, authenticated;
grant select, insert, update, delete on public.reader_keys to service_role;

-- With no version given the key takes the next one, which is what a reader
-- being set up for the first time, or again after being erased, needs. A given
-- version that already exists is left as it is, so a key change that was cut
-- short is finished with the key already stored, not a second one the reader
-- may never have seen.
create function public.store_reader_key(
  p_device_id text,
  p_version integer,
  p_sealed_key text,
  p_actor uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  -- Two organizers setting up the same reader at once must not share a version.
  perform pg_advisory_xact_lock(hashtextextended('reader_keys:' || p_device_id, 0));

  if p_version is null then
    select coalesce(max(k.version), 0) + 1 into v_version
    from public.reader_keys k
    where k.device_id = p_device_id;
  else
    v_version := p_version;
  end if;

  insert into public.reader_keys (device_id, version, sealed_key, created_by)
  values (p_device_id, v_version, p_sealed_key, p_actor)
  on conflict (device_id, version) do nothing;

  return v_version;
end;
$$;

comment on function public.store_reader_key(text, integer, text, uuid) is
  'Stores a sealed key for a reader at the given version, unless one is there already, or at the next free one. Returns the version.';

-- Called once a reader has proved it holds p_version. Nothing is removed for a
-- version this table does not know.
create function public.retire_reader_keys(p_device_id text, p_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer;
begin
  if not exists (
    select 1 from public.reader_keys k
    where k.device_id = p_device_id and k.version = p_version
  ) then
    return 0;
  end if;

  delete from public.reader_keys k
  where k.device_id = p_device_id and k.version < p_version;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

comment on function public.retire_reader_keys(text, integer) is
  'Removes a reader''s keys older than the version it has proved it holds.';

revoke all on function public.store_reader_key(text, integer, text, uuid)
  from public, anon, authenticated;
revoke all on function public.retire_reader_keys(text, integer) from public, anon, authenticated;
grant execute on function public.store_reader_key(text, integer, text, uuid) to service_role;
grant execute on function public.retire_reader_keys(text, integer) to service_role;
