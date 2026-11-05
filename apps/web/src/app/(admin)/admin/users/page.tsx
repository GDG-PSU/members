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
import { requireAdmin, type StaffRole } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { profilePhotoUrl } from '@/lib/profile/photo';
import { formatDate, formatDateTime } from '@/lib/format';
import { inviteExpired, staffInviteExpiry } from '@/lib/auth/link-rules';
import {
  deleteRecordAction,
  revokeInvitationAction,
  revokeUserAccessAction,
} from '@/app/(admin)/admin/actions';
import { Flash } from '@/components/admin/ui';
import { AdminInviteForm } from '@/components/admin/admin-invite-form';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { InviteForm } from '@/components/admin/invite-form';
import { RegenerateInvitationLink } from '@/components/admin/regenerate-invitation-link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'People',
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
  /** Invited, but the link stopped working before it was used. */
  notAccepted: boolean;
};

type StaffDetails = { role: StaffRole; grantedAt: string };

function metadataName(metadata: Record<string, unknown> | undefined): string | null {
  const value = metadata?.full_name ?? metadata?.name;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function currentTime(): number {
  return Date.now();
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
  searchParams: Promise<{ q?: string; invite?: string; notice?: string; error?: string }>;
}) {
  const viewer = await requireAdmin();
  const { q = '', invite, notice, error } = await searchParams;
  const admin = createSupabaseAdmin();
  const isSuperadmin = viewer.isSuperadmin;
  const now = currentTime();

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
  const memberAuthIds = new Set((memberRows ?? []).map((row) => row.auth_user_id as string));
  const staffOnlyAuthIds = [...staffByAuth.keys()].filter((id) => !memberAuthIds.has(id));

  // Supabase sets a random password hash for admin-created users, and clicking
  // an invite link records a sign-in before the password step. The audit log is
  // therefore the reliable signal for whether staff have completed setup.
  const { data: staffAudit } =
    staffOnlyAuthIds.length > 0
      ? await admin
          .from('audit_log')
          .select('action, target_id, created_at')
          .in('action', ['admin.invited', 'auth.password_updated'])
          .in('target_id', staffOnlyAuthIds)
      : { data: [] };
  // When each organizer's invitation stops working: their link's own expiry, or
  // for one invited before links were stored, the same time after the invite.
  const { data: staffLinks } =
    staffOnlyAuthIds.length > 0
      ? await admin
          .from('sign_in_links')
          .select('auth_user_id, expires_at')
          .eq('purpose', 'staff_invite')
          .in('auth_user_id', staffOnlyAuthIds)
      : { data: [] };
  const staffInviteEnds = new Map<string, string>();
  for (const row of staffAudit ?? []) {
    if (row.action !== 'admin.invited' || !row.target_id) continue;
    const ends = staffInviteExpiry(row.created_at as string);
    const known = staffInviteEnds.get(row.target_id as string);
    if (!known || ends > known) staffInviteEnds.set(row.target_id as string, ends);
  }
  for (const row of staffLinks ?? []) {
    staffInviteEnds.set(row.auth_user_id as string, row.expires_at as string);
  }
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
      const staffInvited =
        Boolean(authUser) &&
        invitedStaffAuthIds.has(authUserId) &&
        !passwordSetStaffAuthIds.has(authUserId);
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
        staffInvited,
        invitedAt: null,
        inviteExpiresAt: staffInvited ? (staffInviteEnds.get(authUserId) ?? null) : null,
        notAccepted: staffInvited && inviteExpired(staffInviteEnds.get(authUserId), now),
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
      notAccepted: false,
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
    notAccepted: inviteExpired(row.expires_at as string, now),
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
            row.notAccepted ? 'not accepted' : row.kind === 'invite' ? 'invite pending' : '',
          ].some((value) => value.toLowerCase().includes(needle))
        : true,
    )
    .sort((a, b) => roleRank(a) - roleRank(b) || a.name.localeCompare(b.name));

  // Each person has one page where everything about them is managed. Only
  // superadmins can open it; an organizer's own row leads to their profile.
  const manageHref = (row: UserRow): string | null => {
    if (!isSuperadmin || row.kind === 'invite') return null;
    if (row.memberId) return `/admin/members/${row.memberId}`;
    if (!row.authUserId) return null;
    return row.authUserId === viewer.user.id ? '/admin/profile' : `/admin/staff/${row.authUserId}`;
  };

  return (
    <PageShell className="pb-10">
      <Flash notice={notice} error={error} />

      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-overline text-primary">People</p>
          <h1 className="type-h2 mt-1">People</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isSuperadmin
              ? 'Members, organizers and invitations that are still waiting.'
              : 'Members, and the invitations you sent that are still waiting.'}
          </p>
        </div>
        <form method="get" className="flex w-full gap-2 sm:w-auto">
          <Input
            name="q"
            defaultValue={q}
            placeholder="Name, email or GDG number"
            aria-label="Search people"
            className="h-10 sm:w-72"
          />
          <Button type="submit" variant="secondary" size="sm" className="h-10 shrink-0">
            Search
          </Button>
        </form>
      </div>

      <details
        open={invite === '1'}
        className="mb-6 border border-border bg-card open:pb-5 [&[open]>summary]:border-b"
      >
        <summary className="cursor-pointer border-border px-5 py-3 text-sm font-semibold text-primary">
          Invite someone
        </summary>
        <div className="grid gap-6 px-5 pt-5 md:grid-cols-2 md:gap-8">
          <div>
            <h2 className="type-h3">Invite a member</h2>
            <p className="mb-4 mt-1.5 text-sm leading-relaxed text-muted-foreground">
              For someone who has paid. You get a link to send them yourself.
            </p>
            <InviteForm />
          </div>
          {isSuperadmin ? (
            <div>
              <h2 className="type-h3">Invite an organizer</h2>
              <p className="mb-4 mt-1.5 text-sm leading-relaxed text-muted-foreground">
                An admin runs events, cards and rewards. A superadmin can also manage organizers.
              </p>
              <AdminInviteForm />
            </div>
          ) : null}
        </div>
      </details>

      {users.length === 0 ? (
        <EmptyState
          title={needle ? 'Nobody matches' : 'Nobody here yet'}
          description={
            needle
              ? 'Try a different name, email or GDG number.'
              : 'Invite someone and they appear here.'
          }
        />
      ) : (
        <DataTable
          caption="Members, organizers and invitations"
          rows={users}
          getRowKey={(row) => row.key}
          columns={[
            {
              key: 'user',
              header: 'Person',
              render: (row) => {
                const href = manageHref(row);
                return (
                  <span className="flex items-center gap-3">
                    <MemberAvatar name={row.name} photoUrl={row.photo} size={38} />
                    <span className="min-w-0">
                      {href ? (
                        <Link
                          href={href}
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
                          ? `Invited ${formatDate(row.invitedAt ?? '')}`
                          : row.email}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {row.staffRole === 'superadmin' ? (
                          <Badge variant="primary">Superadmin</Badge>
                        ) : row.staffRole === 'admin' ? (
                          <Badge variant="outline">Admin</Badge>
                        ) : null}
                        {row.kind === 'member' ? <Badge variant="neutral">Member</Badge> : null}
                        {row.staffInvited && !row.notAccepted ? (
                          <Badge variant="warning">Invited</Badge>
                        ) : null}
                        {row.kind === 'invite' && !row.notAccepted ? (
                          <Badge variant="warning">Invite pending</Badge>
                        ) : null}
                        {row.notAccepted ? <Badge variant="neutral">Not accepted</Badge> : null}
                        {row.authUserId === viewer.user.id ? (
                          <Badge variant="outline">You</Badge>
                        ) : null}
                      </span>
                    </span>
                  </span>
                );
              },
            },
            {
              key: 'details',
              header: 'Details',
              render: (row) =>
                row.kind === 'invite' ? (
                  <p className="text-xs text-muted-foreground">
                    {row.notAccepted
                      ? `Link stopped working ${formatDateTime(row.inviteExpiresAt ?? '')}`
                      : row.inviteExpiresAt
                        ? `Link works until ${formatDateTime(row.inviteExpiresAt)}`
                        : 'Not accepted yet'}
                  </p>
                ) : row.memberNumber ? (
                  <div>
                    <p className="font-mono text-xs">{row.memberNumber}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Member since {row.memberSince ? formatDate(row.memberSince) : 'unknown'}
                    </p>
                  </div>
                ) : row.staffInvited && row.inviteExpiresAt ? (
                  <p className="text-xs text-muted-foreground">
                    {row.notAccepted
                      ? `Link stopped working ${formatDateTime(row.inviteExpiresAt)}`
                      : `Link works until ${formatDateTime(row.inviteExpiresAt)}`}
                  </p>
                ) : row.staffSince ? (
                  <p className="text-xs text-muted-foreground">
                    Organizer since {formatDate(row.staffSince)}
                  </p>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) =>
                row.notAccepted ? (
                  <StatusChip status="draft" label="Not accepted" />
                ) : row.kind === 'invite' ? (
                  <StatusChip status="pending" label="Waiting" />
                ) : row.memberStatus ? (
                  <StatusChip status={row.memberStatus} />
                ) : (
                  <StatusChip
                    status={row.staffInvited ? 'pending' : 'active'}
                    label={row.staffInvited ? 'Setting up' : 'Active'}
                  />
                ),
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (row) => {
                if (row.kind === 'invite' && row.invitationId) {
                  return (
                    <div className="flex flex-col items-end gap-1.5">
                      <RegenerateInvitationLink invitationId={row.invitationId} />
                      <ConfirmAction
                        action={revokeInvitationAction}
                        fields={{ returnTo: '/admin/users', invitationId: row.invitationId }}
                        label="Cancel invitation"
                        variant="ghost"
                        destructive
                        title={`Cancel the invitation for ${row.email}?`}
                        description="Their link stops working. You can invite them again later."
                        confirmLabel="Yes, cancel it"
                      />
                      {isSuperadmin ? (
                        <ConfirmAction
                          action={deleteRecordAction}
                          fields={{
                            kind: 'invitation',
                            id: row.invitationId,
                            returnTo: '/admin/users',
                          }}
                          label="Delete for good"
                          variant="ghost"
                          destructive
                          title={`Delete the invitation for ${row.email} for good?`}
                          description="The invitation and the unused account made for it are removed. You can invite them again later."
                          confirmLabel="Yes, delete it for good"
                        />
                      ) : null}
                    </div>
                  );
                }

                const href = manageHref(row);
                if (href) {
                  return (
                    <Link
                      href={href}
                      className={buttonVariants({ size: 'sm', variant: 'secondary' })}
                    >
                      {row.authUserId === viewer.user.id ? 'My profile' : 'Manage'}
                    </Link>
                  );
                }
                // An admin cannot open a member's page, but can remove their access.
                return row.kind === 'member' &&
                  row.authUserId &&
                  row.memberStatus !== 'archived' ? (
                  <ConfirmAction
                    action={revokeUserAccessAction}
                    fields={{ returnTo: '/admin/users', authUserId: row.authUserId }}
                    label="Remove access"
                    variant="ghost"
                    destructive
                    title={`Remove ${row.name}'s access?`}
                    description="They can no longer sign in, and their profile and card stop working. Their history is kept."
                    confirmLabel="Yes, remove access"
                  />
                ) : null;
              },
            },
          ]}
        />
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {isSuperadmin
          ? 'Select Manage to change someone’s type, give points, reset a password or remove access.'
          : 'Organizers, type changes and the audit log are for superadmins.'}
      </p>
    </PageShell>
  );
}
