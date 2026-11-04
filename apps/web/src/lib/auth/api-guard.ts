import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';
import type { StaffRole } from '@/lib/auth/viewer';

export interface ApiViewer {
  supabase: SupabaseClient;
  user: User;
  isAdmin: boolean;
  isSuperadmin: boolean;
  role: StaffRole | null;
}

export async function getApiViewer(): Promise<ApiViewer | null> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createSupabaseAdmin();
  const { data: roleRows } = await admin
    .from('user_roles')
    .select('role')
    .eq('auth_user_id', user.id)
    .in('role', ['admin', 'superadmin'])
    .is('revoked_at', null);

  const roles = (roleRows ?? []).map((row) => row.role as StaffRole);
  const role: StaffRole | null = roles.includes('superadmin')
    ? 'superadmin'
    : roles.includes('admin')
      ? 'admin'
      : null;
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const aal2 = assurance?.currentLevel === 'aal2';

  return {
    supabase,
    user,
    isAdmin: role !== null && aal2,
    isSuperadmin: role === 'superadmin' && aal2,
    role,
  };
}
