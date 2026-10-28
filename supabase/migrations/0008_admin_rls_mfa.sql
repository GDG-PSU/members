-- Admin RLS applies only to an MFA-verified session. The role record remains
-- readable to its owner so an admin can reach the MFA enrollment flow at AAL1.
create policy "users read their own role" on public.user_roles for select
  to authenticated using (auth_user_id = auth.uid());

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select uid = auth.uid()
    and (auth.jwt() ->> 'aal') = 'aal2'
    and exists (
      select 1 from public.user_roles ur
      where ur.auth_user_id = uid and ur.role = 'admin' and ur.revoked_at is null
    );
$$;
