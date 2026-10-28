import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

export interface ApiViewer {
  supabase: SupabaseClient;
  user: User;
  isAdmin: boolean;
}

export async function getApiViewer(): Promise<ApiViewer | null> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createSupabaseAdmin();
  const { data: role } = await admin
    .from('user_roles')
    .select('role')
    .eq('auth_user_id', user.id)
    .is('revoked_at', null)
    .maybeSingle();

  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return { supabase, user, isAdmin: role?.role === 'admin' && assurance?.currentLevel === 'aal2' };
}
