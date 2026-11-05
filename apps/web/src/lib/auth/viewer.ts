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

export type StaffRole = 'admin' | 'superadmin';

/**
 * The signed-in person's own profile. Members and organizers both have one; only
 * a member also has a `member` session with points, attendance and rewards.
 */
export interface ProfileSession {
  memberId: string;
  kind: 'member' | 'organizer';
  slug: string;
  displayName: string;
  /** Organizers may have no photo; members always have one. */
  photoPath: string | null;
}

export interface Viewer {
  supabase: SupabaseClient;
  user: User | null;
  /** Set for members only, so member pages and member rules never see an organizer. */
  member: MemberSession | null;
  profile: ProfileSession | null;
  isAdmin: boolean;
  isSuperadmin: boolean;
  role: StaffRole | null;
}

export async function getViewer(): Promise<Viewer> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      supabase,
      user: null,
      member: null,
      profile: null,
      isAdmin: false,
      isSuperadmin: false,
      role: null,
    };
  }

  const [{ data: memberRow }, { data: roleRows }] = await Promise.all([
    // Not an inner join: RLS hides the profile of a suspended member, and that
    // member must still resolve so requireMember can send them to the right page.
    supabase
      .from('members')
      .select(
        'id, kind, status, public_number, member_since, member_profiles(profile_slug, display_name, photo_path)',
      )
      .eq('auth_user_id', user.id)
      .maybeSingle(),
    supabase
      .from('user_roles')
      .select('role')
      .eq('auth_user_id', user.id)
      .in('role', ['admin', 'superadmin'])
      .is('revoked_at', null),
  ]);

  const profile = Array.isArray(memberRow?.member_profiles)
    ? memberRow?.member_profiles[0]
    : memberRow?.member_profiles;

  const kind = memberRow?.kind === 'organizer' ? 'organizer' : 'member';
  const member =
    memberRow && kind === 'member' && (profile || memberRow.status !== 'active')
      ? {
          id: memberRow.id as string,
          status: memberRow.status as MemberSession['status'],
          publicNumber: memberRow.public_number as string,
          memberSince: memberRow.member_since as string,
          slug: (profile?.profile_slug as string | undefined) ?? '',
          displayName: (profile?.display_name as string | undefined) ?? 'Member',
          photoPath: (profile?.photo_path as string | undefined) ?? '',
          authUserId: user.id,
        }
      : null;

  const roles = (roleRows ?? []).map((row) => row.role as StaffRole);
  const role: StaffRole | null = roles.includes('superadmin')
    ? 'superadmin'
    : roles.includes('admin')
      ? 'admin'
      : null;

  // An organizer whose staff access was revoked keeps an archived row, which is
  // not a profile they can use.
  const ownProfile: ProfileSession | null =
    memberRow && profile && memberRow.status === 'active'
      ? {
          memberId: memberRow.id as string,
          kind,
          slug: profile.profile_slug as string,
          displayName: profile.display_name as string,
          photoPath: (profile.photo_path as string | null) ?? null,
        }
      : null;

  return {
    supabase,
    user,
    member,
    profile: ownProfile,
    isAdmin: role !== null,
    isSuperadmin: role === 'superadmin',
    role,
  };
}

export async function requireUser(): Promise<Viewer & { user: User }> {
  const viewer = await getViewer();
  if (!viewer.user) redirect('/login');
  return viewer as Viewer & { user: User };
}

export async function requireMember(): Promise<Viewer & { user: User; member: MemberSession }> {
  const viewer = await requireUser();
  if (!viewer.member) redirect(viewer.isAdmin ? '/admin' : '/invite/accept');
  if (viewer.member.status !== 'active') redirect('/account-suspended');
  return viewer as Viewer & { user: User; member: MemberSession };
}

/** For editing one's own profile, which members and organizers both do. */
export async function requireProfile(): Promise<Viewer & { user: User; profile: ProfileSession }> {
  const viewer = await requireUser();
  if (viewer.member && viewer.member.status !== 'active') redirect('/account-suspended');
  if (!viewer.profile) redirect(viewer.isAdmin ? '/admin-setup' : '/invite/accept');
  if (viewer.profile.kind === 'organizer') {
    // An organizer's profile is only theirs while they are staff with a verified code.
    if (!viewer.isAdmin) redirect('/');
    const { data: assurance } = await viewer.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance?.currentLevel !== 'aal2') redirect('/admin-mfa');
  }
  return viewer as Viewer & { user: User; profile: ProfileSession };
}

export async function requireAdmin(): Promise<
  Viewer & { user: User; isAdmin: true; role: StaffRole }
> {
  const viewer = await requireUser();
  if (!viewer.isAdmin) {
    redirect('/?notice=admin-required');
  }
  const { data: assurance } = await viewer.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== 'aal2') redirect('/admin-mfa');
  return viewer as Viewer & { user: User; isAdmin: true; role: StaffRole };
}

export async function requireSuperadmin(): Promise<
  Viewer & { user: User; isAdmin: true; isSuperadmin: true; role: 'superadmin' }
> {
  const viewer = await requireAdmin();
  if (!viewer.isSuperadmin) {
    redirect('/admin?notice=superadmin-required');
  }
  return viewer as Viewer & {
    user: User;
    isAdmin: true;
    isSuperadmin: true;
    role: 'superadmin';
  };
}
