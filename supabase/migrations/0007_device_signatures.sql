-- Existing devices must be rotated before the signed protocol can be used.
alter table public.devices add column secret_ciphertext text;
comment on column public.devices.secret_ciphertext is
  'Encrypted per-device HMAC key; existing device secrets require rotation.';

create table public.device_request_nonces (
  device_id uuid not null references public.devices(id) on delete cascade,
  request_id text not null,
  created_at timestamptz not null default now(),
  primary key (device_id, request_id)
);
create index device_request_nonces_created_at_idx on public.device_request_nonces(created_at);
alter table public.device_request_nonces enable row level security;
revoke all on public.device_request_nonces from public, anon, authenticated;
grant select, insert, delete on public.device_request_nonces to service_role;

create function public.consume_device_nonce(p_device_id uuid, p_request_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if pg_catalog.random() < 0.01 then
    delete from public.device_request_nonces where created_at < now() - interval '10 minutes';
  end if;
  insert into public.device_request_nonces (device_id, request_id) values (p_device_id, p_request_id)
    on conflict do nothing;
  return found;
end;
$$;
revoke all on function public.consume_device_nonce(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_device_nonce(uuid, text) to service_role;
