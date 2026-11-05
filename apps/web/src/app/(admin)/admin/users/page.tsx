import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Button,
  buttonVariants,
  DataTable,
  EmptyState,
  Input,
  MemberAvatar,
  PageShell,
  Select,
  StatusChip,
} from '@gdg/ui';
import { requireAdmin, type StaffRole } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { profilePhotoUrl } from '@/lib/profile/photo';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  changeUserRoleAction,
  revokeInvitationAction,
  revokeUserAccessAction,
} from '@/app/(admin)/admin/actions';
import { Flash, SubmitButton } from '@/components/admin/ui';
import { RegenerateInvitationLink } from '@/components/admin/regenerate-invitation-link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Users',
  robots: { index: false, follow: false },
};

type UserKind = 'member' | 'staff' | 'invite';

type UserRow = {
  key: string;
  kind: UserKind;
  authUserId: string | null;
  memberId: string | null;
  invitationId: string | null;
  name: string;
  email: string;
  photo: string | null;
  memberNumber: string | null;
  memberSince: string | null;
  memberStatus: string | null;
  staffRole: StaffRole | null;
  staffSince: string | null;
  staffInvited: boolean;
  invitedAt: string | null;
  inviteExpiresAt: string | null;
};

type StaffDetails = { role: StaffRole; grantedAt: string };

function metadataName(metadata: Record<string, unknown> | undefined): string | null {
  const value = metadata?.full_name ?? metadata?.name;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function roleRank(row: UserRow): number {
  if (row.staffRole === 'superadmin') return 0;
  if (row.staffRole === 'admin') return 1;
  if (row.kind === 'member') return 2;
  return 3;
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; notice?: string; error?: string }>;
}) {
  const viewer = await requireAdmin();
  const { q = '', notice, error } = await searchParams;
  const admin = createSupabaseAdmin();
  const isSuperadmin = viewer.isSuperadmin;

  let inviteQuery = admin
    .from('member_invitations')
    .select('id, email, status, paid_since, created_at, expires_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(200);
  if (!isSuperadmin) {
    inviteQuery = inviteQuery.eq('created_by', viewer.user.id);
  }

  const [{ data: memberRows }, { data: inviteRows }, { data: roleRows }] = await Promise.all([
    admin
      .from('members')
      .select(
        'id, auth_user_id, status, public_number, member_since, created_at, member_profiles(profile_slug, display_name, photo_path), member_private(email)',
      )
      // Organizers have a profile row too, but they are listed as staff below.
      .eq('kind', 'member')
      .order('member_since', { ascending: false })
      .limit(500),
    inviteQuery,
    isSuperadmin
      ? admin
          .from('user_roles')
          .select('auth_user_id, role, granted_at')
          .in('role', ['admin', 'superadmin'])
          .is('revoked_at', null)
      : Promise.resolve({
          data: [] as { auth_user_id: string; role: string; granted_at: string }[],
        }),
  ]);

  const activeRoles = roleRows ?? [];
  const staffByAuth = new Map<string, StaffDetails>();
  for (const row of activeRoles) {
    const authUserId = row.auth_user_id as string;
    const role = row.role as StaffRole;
    const current = staffByAuth.get(authUserId);
    if (!current || role === 'superadmin') {
      staffByAuth.set(authUserId, { role, grantedAt: row.granted_at as string });
    }
  }
  const superadminCount = activeRoles.filter((row) => row.role === 'superadmin').length;
  const memberAuthIds = new Set((memberRows ?? []).map((row) => row.auth_user_id as string));
  const staffOnlyAuthIds = [...staffByAuth.keys()].filter((id) => !memberAuthIds.has(id));

  // Supabase sets a random password hash for admin-created users, and clicking
  // an invite link records a sign-in before the password step. The audit log is
  // therefore the reliable signal for whether staff have completed setup.
  const { data: staffAudit } =
    staffOnlyAuthIds.length > 0
      ? await admin
          .from('audit_log')
          .select('action, target_id')
          .in('action', ['admin.invited', 'auth.password_updated'])
          .in('target_id', staffOnlyAuthIds)
      : { data: [] };
  const invitedStaffAuthIds = new Set(
    (staffAudit ?? [])
      .filter((row) => row.action === 'admin.invited' && row.target_id)
      .map((row) => row.target_id as string),
  );
  const passwordSetStaffAuthIds = new Set(
    (staffAudit ?? [])
      .filter((row) => row.action === 'auth.password_updated' && row.target_id)
      .map((row) => row.target_id as string),
  );

  // A staff member's own profile gives them a real name and photo in this list.
  const { data: organizerRows } =
    staffOnlyAuthIds.length > 0
      ? await admin
          .from('members')
          .select('auth_user_id, member_profiles(profile_slug, display_name, photo_path)')
          .eq('kind', 'organizer')
          .in('auth_user_id', staffOnlyAuthIds)
      : { data: [] };
  const organizerByAuth = new Map(
    (organizerRows ?? []).map((row) => {
      const profile = Array.isArray(row.member_profiles)
        ? row.member_profiles[0]
        : row.member_profiles;
      return [row.auth_user_id as string, profile] as const;
    }),
  );

  const staffOnlyUsers: UserRow[] = await Promise.all(
    staffOnlyAuthIds.map(async (authUserId) => {
      const { data } = await admin.auth.admin.getUserById(authUserId);
      const authUser = data.user;
      const staff = staffByAuth.get(authUserId);
      const organizer = organizerByAuth.get(authUserId);
      return {
        key: `user:${authUserId}`,
        kind: 'staff' as const,
        authUserId,
        memberId: null,
        invitationId: null,
        name:
          (organizer?.display_name as string | undefined) ??
          metadataName(authUser?.user_metadata) ??
          (staff?.role === 'superadmin' ? 'Superadmin' : 'Administrator'),
        email: authUser?.email ?? 'No email',
        photo: organizer?.photo_path
          ? profilePhotoUrl((organizer.profile_slug as string) ?? null)
          : null,
        memberNumber: null,
        memberSince: null,
        memberStatus: null,
        staffRole: staff?.role ?? null,
        staffSince: staff?.grantedAt ?? null,
        staffInvited:
          Boolean(authUser) &&
          invitedStaffAuthIds.has(authUserId) &&
          !passwordSetStaffAuthIds.has(authUserId),
        invitedAt: null,
        inviteExpiresAt: null,
      };
    }),
  );

  const memberUsers: UserRow[] = (memberRows ?? []).map((row) => {
    const profile = Array.isArray(row.member_profiles)
      ? row.member_profiles[0]
      : row.member_profiles;
    const priv = Array.isArray(row.member_private) ? row.member_private[0] : row.member_private;
    const authUserId = row.auth_user_id as string;
    const staff = staffByAuth.get(authUserId);
    return {
      key: `member:${row.id}`,
      kind: 'member',
      authUserId,
      memberId: row.id as string,
      invitationId: null,
      name: (profile?.display_name as string) ?? 'Unknown',
      email: (priv?.email as string) ?? 'No email',
      photo: profilePhotoUrl((profile?.profile_slug as string) ?? null),
      memberNumber: row.public_number as string,
      memberSince: row.member_since as string,
      memberStatus: row.status as string,
      staffRole: staff?.role ?? null,
      staffSince: staff?.grantedAt ?? null,
      staffInvited: false,
      invitedAt: null,
      inviteExpiresAt: null,
    };
  });

  const inviteUsers: UserRow[] = (inviteRows ?? []).map((row) => ({
    key: `invite:${row.id}`,
    kind: 'invite',
    authUserId: null,
    memberId: null,
    invitationId: row.id as string,
    name: row.email as string,
    email: row.email as string,
    photo: null,
    memberNumber: null,
    memberSince: null,
    memberStatus: null,
    staffRole: null,
    staffSince: null,
    staffInvited: false,
    invitedAt: row.created_at as string,
    inviteExpiresAt: row.expires_at as string,
  }));

  const needle = q.trim().toLowerCase();
  const users = [...staffOnlyUsers, ...memberUsers, ...inviteUsers]
    .filter((row) =>
      needle
        ? [
            row.name,
            row.email,
            row.memberNumber ?? '',
            row.staffRole ?? '',
            row.staffInvited ? 'invited' : '',
            row.kind === 'invite' ? 'invite pending' : '',
          ].some((value) => value.toLowerCase().includes(needle))
        : true,
    )
    .sort((a, b) => roleRank(a) - roleRank(b) || a.name.localeCompare(b.name));

  return (
    <PageShell className="pb-10">
      <Flash notice={notice} error={error} />

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-overline text-primary">People</p>
          <h1 className="type-h2 mt-1">Users</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isSuperadmin
              ? 'Members, staff and pending invitations in one place.'
              : 'Members and the invitations you created. Invite or revoke member access.'}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <form method="get" className="flex w-full gap-2 sm:w-auto">
            <Input
              name="q"
              defaultValue={q}
              placeholder="Search name, email, member no."
              aria-label="Search users"
              className="h-10 sm:w-72"
            />
            <Button type="submit" variant="secondary" size="sm" className="h-10 shrink-0">
              Search
            </Button>
          </form>
          <Link href="/admin/invitations" className={buttonVariants({ variant: 'secondary' })}>
            Invite user
          </Link>
        </div>
      </div>

      {users.length === 0 ? (
        <EmptyState
          title={needle ? 'No matches' : 'No users yet'}
          description={
            needle
              ? 'Try a different name, email, member number, role or invite stage.'
              : 'Accepted members, pending invitations and active staff accounts appear here.'
          }
        />
      ) : (
        <DataTable
          caption="Members, staff and invitations"
          rows={users}
          getRowKey={(row) => row.key}
          columns={[
            {
              key: 'user',
              header: 'User',
              render: (row) => (
                <span className="flex items-center gap-3">
                  <MemberAvatar name={row.name} photoUrl={row.photo} size={38} />
                  <span className="min-w-0">
                    {row.memberId && isSuperadmin ? (
                      <Link
                        href={`/admin/members/${row.memberId}`}
                        className="block truncate text-sm font-semibold underline-offset-2 hover:text-primary hover:underline"
                      >
                        {row.name}
                      </Link>
                    ) : (
                      <span className="block truncate text-sm font-semibold">
                        {row.kind === 'invite' ? row.email : row.name}
                      </span>
                    )}
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.kind === 'invite'
                        ? `Invite sent ${formatDate(row.invitedAt ?? '')}`
                        : row.email}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {row.staffRole === 'superadmin' ? (
                        <Badge variant="primary">Superadmin</Badge>
                      ) : row.staffRole === 'admin' ? (
                        <Badge variant="outline">Admin</Badge>
                      ) : null}
                      {row.kind === 'member' ? <Badge variant="neutral">Member</Badge> : null}
                      {row.staffInvited ? <Badge variant="warning">Invited</Badge> : null}
                      {row.kind === 'invite' ? (
                        <Badge variant="warning">Invite pending</Badge>
                      ) : null}
                      {row.authUserId === viewer.user.id ? (
                        <Badge variant="outline">You</Badge>
                      ) : null}
                    </span>
                  </span>
                </span>
              ),
            },
            {
              key: 'member',
              header: 'Member',
              render: (row) =>
                row.kind === 'invite' ? (
                  <div>
                    <p className="text-xs">Not accepted yet</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {row.inviteExpiresAt
                        ? `expires ${formatDateTime(row.inviteExpiresAt)}`
                        : 'pending'}
                    </p>
                  </div>
                ) : row.memberNumber ? (
                  <div>
                    <p className="font-mono text-xs">{row.memberNumber}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      since {row.memberSince ? formatDate(row.memberSince) : 'unknown'}
                    </p>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                ),
            },
            {
              key: 'staff',
              header: 'Staff since',
              render: (row) =>
                row.staffSince ? (
                  <span className="text-xs">{formatDate(row.staffSince)}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) =>
                row.kind === 'invite' ? (
                  <Badge variant="outline">Invite stage</Badge>
                ) : row.memberStatus ? (
                  <StatusChip status={row.memberStatus} />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                ),
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (row) => {
                const lastSuperadmin = row.staffRole === 'superadmin' && superadminCount <= 1;
                const canChangeRole =
                  isSuperadmin &&
                  Boolean(row.authUserId) &&
                  row.authUserId !== viewer.user.id &&
                  !lastSuperadmin;
                const canRevoke =
                  Boolean(row.authUserId) &&
                  row.authUserId !== viewer.user.id &&
                  (!row.staffRole || isSuperadmin) &&
                  !lastSuperadmin;

                if (row.kind === 'invite' && row.invitationId) {
                  return (
                    <div className="flex flex-col items-end gap-1.5">
                      <RegenerateInvitationLink invitationId={row.invitationId} />
                      <form action={revokeInvitationAction}>
                        <input type="hidden" name="returnTo" value="/admin/users" />
                        <input type="hidden" name="invitationId" value={row.invitationId} />
                        <SubmitButton
                          size="small"
                          variant="text"
                          color="error"
                          confirmMessage="Revoke this invitation? The link stops working."
                        >
                          Revoke invite
                        </SubmitButton>
                      </form>
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col items-end gap-1.5">
                    {row.memberId && isSuperadmin ? (
                      <Link
                        href={`/admin/members/${row.memberId}`}
                        className={buttonVariants({ size: 'sm', variant: 'secondary' })}
                      >
                        Manage
                      </Link>
                    ) : null}
                    {canChangeRole ? (
                      <form
                        action={changeUserRoleAction}
                        className="flex flex-wrap items-center justify-end gap-1.5"
                      >
                        <input type="hidden" name="returnTo" value="/admin/users" />
                        <input type="hidden" name="authUserId" value={row.authUserId ?? ''} />
                        <Select
                          name="role"
                          aria-label={`User type for ${row.name}`}
                          defaultValue={row.staffRole ?? 'member'}
                          className="h-8 w-[8.75rem] text-xs"
                        >
                          <option value="superadmin">Superadmin</option>
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </Select>
                        <SubmitButton
                          size="small"
                          variant="outlined"
                          pendingLabel="Saving…"
                          confirmMessage="Change this user's type? Making a member staff permanently deletes their member profile, cards, attendance, points and rewards. Making staff a member opens member setup on their next sign-in."
                        >
                          Save
                        </SubmitButton>
                      </form>
                    ) : null}
                    {canRevoke ? (
                      <form action={revokeUserAccessAction}>
                        <input type="hidden" name="returnTo" value="/admin/users" />
                        <input type="hidden" name="authUserId" value={row.authUserId ?? ''} />
                        <SubmitButton
                          size="small"
                          variant="text"
                          color="error"
                          confirmMessage={
                            row.kind === 'member'
                              ? 'Revoke this member access? The account is archived and cannot sign in.'
                              : 'Revoke this staff access? They lose admin access immediately.'
                          }
                        >
                          Revoke access
                        </SubmitButton>
                      </form>
                    ) : null}
                    {lastSuperadmin ? (
                      <span className="text-[0.7rem] text-muted-foreground">Last superadmin</span>
                    ) : null}
                  </div>
                );
              },
            },
          ]}
        />
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {isSuperadmin
          ? 'Invited staff have a role but have not finished setting a password. Superadmins can change any user type. Promoting a member deletes their member profile, cards, attendance, points and rewards. Demoting staff to member keeps their password and creates an invitation for member setup. Normal admins can invite and revoke members only.'
          : 'You can invite members and revoke member access. Staff accounts, user-type changes and the audit log are superadmin-only.'}
      </p>
    </PageShell>
  );
}
