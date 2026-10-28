-- Audit rows are historical records and must outlive the accounts they name.
-- The previous ON DELETE SET NULL foreign key tried to UPDATE the row when an
-- Auth user was deleted, but the append-only trigger correctly blocks updates,
-- so any account with audit history could never be deleted. Keep the actor UUID
-- for traceability and drop the constraint.
alter table public.audit_log
  drop constraint audit_log_actor_auth_id_fkey;
