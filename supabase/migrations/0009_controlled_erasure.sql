-- ---------------------------------------------------------------------------
-- 0009 — Controlled member erasure.
--
-- The append-only guards (0001) block every UPDATE and DELETE on the ledger and
-- attendance audit tables. That also blocks the `ON DELETE CASCADE` path from
-- auth.users, making the documented account-closure operation impossible once a
-- member has any history. Erasure stays a deliberate, server-only action:
-- ordinary writes are still refused, and only this function may lift the guard
-- for the duration of its own transaction.
-- ---------------------------------------------------------------------------

create or replace function public.prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.member_erasure', true), 'off') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'append_only_relation' using errcode = 'P0001';
end;
$$;

comment on function public.prevent_mutation() is
  'Append-only guard; only public.erase_member() may lift it, transaction-locally.';

create function public.erase_member(p_auth_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
begin
  if p_auth_user_id is null then
    raise exception 'auth_user_id_required' using errcode = 'P0001';
  end if;

  select id into v_member_id from public.members where auth_user_id = p_auth_user_id;
  perform set_config('app.member_erasure', 'on', true);

  -- Cascades through members into profiles, cards, attendance, ledgers and
  -- redemptions. audit_log rows are intentionally retained (see 0005).
  delete from auth.users where id = p_auth_user_id;
  if not found then
    raise exception 'auth_user_not_found' using errcode = 'P0001';
  end if;

  return v_member_id;
end;
$$;

comment on function public.erase_member(uuid) is
  'Reviewed account closure: removes the auth user and all cascading member data, keeping audit history.';

revoke all on function public.erase_member(uuid) from public, anon, authenticated;
grant execute on function public.erase_member(uuid) to service_role;
