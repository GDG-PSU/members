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
  StatusChip,
} from '@gdg/ui';
import { requireSuperadmin, type StaffRole } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { profilePhotoUrl } from '@/lib/profile/photo';
import { formatDate } from '@/lib/format';
import { revokeStaffAccessAction } from '@/app/(admin)/admin/actions';
import { Flash, SubmitButton } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Users',
  robots: { index: false, follow: false },
};

type UserRow = {
  authUserId: string;
  memberId: string | null;
  name: string;
  email: string;
  photo: string | null;
  memberNumber: string | null;
  memberSince: string | null;
  memberStatus: string | null;
  staffRole: StaffRole | null;
  staffSince: string | null;
};

type StaffDetails = { role: StaffRole; grantedAt: string };

function metadataName(metadata: Record<string, unknown> | undefined): string | null {
  const value = metadata?.full_name ?? metadata?.name;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function roleRank(row: UserRow): number {
  if (row.staffRole === 'superadmin') return 0;
  if (row.staffRole === 'admin') return 1;
  return 2;
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; notice?: string; error?: string }>;
}) {
  const viewer = await requireSuperadmin();
  const { q = '', notice, error } = await searchParams;
  const admin = createSupabaseAdmin();

  const [{ data: memberRows }, { data: roleRows }] = await Promise.all([
    admin
      .from('members')
      .select(
        'id, auth_user_id, status, public_number, member_since, created_at, member_profiles(profile_slug, display_name, photo_path), member_private(email)',
      )
      .order('member_since', { ascending: false })
      .limit(500),
    admin
      .from('user_roles')
      .select('auth_user_id, role, granted_at')
      .in('role', ['admin', 'superadmin'])
      .is('revoked_at', null),
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

  const staffOnlyUsers: UserRow[] = await Promise.all(
    staffOnlyAuthIds.map(async (authUserId) => {
      const { data } = await admin.auth.admin.getUserById(authUserId);
      const authUser = data.user;
      const staff = staffByAuth.get(authUserId);
      return {
        authUserId,
        memberId: null,
        name:
          metadataName(authUser?.user_metadata) ??
          (staff?.role === 'superadmin' ? 'Superadmin' : 'Administrator'),
        email: authUser?.email ?? 'No email',
        photo: null,
        memberNumber: null,
        memberSince: null,
        memberStatus: null,
        staffRole: staff?.role ?? null,
        staffSince: staff?.grantedAt ?? null,
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
      authUserId,
      memberId: row.id as string,
      name: (profile?.display_name as string) ?? 'Unknown',
      email: (priv?.email as string) ?? 'No email',
      photo: profilePhotoUrl((profile?.profile_slug as string) ?? null),
      memberNumber: row.public_number as string,
      memberSince: row.member_since as string,
      memberStatus: row.status as string,
      staffRole: staff?.role ?? null,
      staffSince: staff?.grantedAt ?? null,
    };
  });

  const needle = q.trim().toLowerCase();
  const users = [...staffOnlyUsers, ...memberUsers]
    .filter((row) =>
      needle
        ? [row.name, row.email, row.memberNumber ?? '', row.staffRole ?? ''].some((value) =>
            value.toLowerCase().includes(needle),
          )
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
            Members and staff accounts in one place.
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
              ? 'Try a different name, email, member number or role.'
              : 'Accepted members and active staff accounts appear here.'
          }
        />
      ) : (
        <DataTable
          caption="Members and staff"
          rows={users}
          getRowKey={(row) => row.authUserId}
          columns={[
            {
              key: 'user',
              header: 'User',
              render: (row) => (
                <span className="flex items-center gap-3">
                  <MemberAvatar name={row.name} photoUrl={row.photo} size={38} />
                  <span className="min-w-0">
                    {row.memberId ? (
                      <Link
                        href={`/admin/members/${row.memberId}`}
                        className="block truncate text-sm font-semibold underline-offset-2 hover:text-primary hover:underline"
                      >
                        {row.name}
                      </Link>
                    ) : (
                      <span className="block truncate text-sm font-semibold">{row.name}</span>
                    )}
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.email}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {row.staffRole === 'superadmin' ? (
                        <Badge variant="primary">Superadmin</Badge>
                      ) : row.staffRole === 'admin' ? (
                        <Badge variant="outline">Admin</Badge>
                      ) : null}
                      {row.memberId ? <Badge variant="neutral">Member</Badge> : null}
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
                row.memberNumber ? (
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
                row.memberStatus ? (
                  <StatusChip status={row.memberStatus} />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                ),
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (row) => (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {row.memberId ? (
                    <Link
                      href={`/admin/members/${row.memberId}`}
                      className={buttonVariants({ size: 'sm', variant: 'secondary' })}
                    >
                      Manage
                    </Link>
                  ) : null}
                  {row.staffRole &&
                  row.authUserId !== viewer.user.id &&
                  (row.staffRole === 'admin' || superadminCount > 1) ? (
                    <form action={revokeStaffAccessAction}>
                      <input type="hidden" name="returnTo" value="/admin/users" />
                      <input type="hidden" name="authUserId" value={row.authUserId} />
                      <SubmitButton
                        size="small"
                        variant="text"
                        color="error"
                        confirmMessage="Revoke this user's staff access? Their member account is unchanged."
                      >
                        Revoke staff
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Staff access can be revoked except your own or the last active superadmin. Revoking staff
        access does not delete the account or its member record.
      </p>
    </PageShell>
  );
}
