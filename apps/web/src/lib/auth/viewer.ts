import { redirect } from 'next/navigation';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createSupabaseServer } from '@/lib/supabase/server';

export interface MemberSession {
  id: string;
  status: 'active' | 'suspended' | 'archived';
  publicNumber: string;
  memberSince: string;
  slug: string;
  displayName: string;
  photoPath: string;
  authUserId: string;
}

export interface Viewer {
  supabase: SupabaseClient;
  user: User | null;
  member: MemberSession | null;
  isAdmin: boolean;
}

export async function getViewer(): Promise<Viewer> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, member: null, isAdmin: false };
  }

  const [{ data: memberRow }, { data: roleRow }] = await Promise.all([
    supabase
      .from('members')
      .select(
        'id, status, public_number, member_since, member_profiles!inner(profile_slug, display_name, photo_path)',
      )
      .eq('auth_user_id', user.id)
      .maybeSingle(),
    supabase
      .from('user_roles')
      .select('role')
      .eq('auth_user_id', user.id)
      .is('revoked_at', null)
      .maybeSingle(),
  ]);

  const profile = Array.isArray(memberRow?.member_profiles)
    ? memberRow?.member_profiles[0]
    : memberRow?.member_profiles;

  const member =
    memberRow && profile
      ? {
          id: memberRow.id as string,
          status: memberRow.status as MemberSession['status'],
          publicNumber: memberRow.public_number as string,
          memberSince: memberRow.member_since as string,
          slug: profile.profile_slug as string,
          displayName: profile.display_name as string,
          photoPath: profile.photo_path as string,
          authUserId: user.id,
        }
      : null;

  return { supabase, user, member, isAdmin: roleRow?.role === 'admin' };
}

export async function requireUser(): Promise<Viewer & { user: User }> {
  const viewer = await getViewer();
  if (!viewer.user) redirect('/login');
  return viewer as Viewer & { user: User };
}

export async function requireMember(): Promise<Viewer & { user: User; member: MemberSession }> {
  const viewer = await requireUser();
  if (!viewer.member) redirect('/invite/accept');
  if (viewer.member.status !== 'active') redirect('/account-suspended');
  return viewer as Viewer & { user: User; member: MemberSession };
}

export async function requireAdmin(): Promise<Viewer & { user: User; isAdmin: true }> {
  const viewer = await requireUser();
  if (!viewer.isAdmin) {
    redirect('/?notice=admin-required');
  }
  const { data: assurance } = await viewer.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== 'aal2') redirect('/admin-mfa');
  return viewer as Viewer & { user: User; isAdmin: true };
}
