import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Button,
  DataTable,
  EmptyState,
  Input,
  MemberAvatar,
  PageShell,
  StatusChip,
  buttonVariants,
} from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { profilePhotoUrl } from '@/lib/profile/photo';
import { formatDate } from '@/lib/format';
import { Flash } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Members',
  robots: { index: false, follow: false },
};

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; notice?: string; error?: string }>;
}) {
  await requireAdmin();
  const { q = '', notice, error } = await searchParams;
  const admin = createSupabaseAdmin();

  const { data: rows } = await admin
    .from('members')
    .select(
      'id, status, public_number, member_since, created_at, member_profiles(profile_slug, display_name, photo_path), member_private(email)',
    )
    .order('member_since', { ascending: false })
    .limit(200);

  const needle = q.trim().toLowerCase();
  const members = (rows ?? [])
    .map((row) => {
      const profile = Array.isArray(row.member_profiles)
        ? row.member_profiles[0]
        : row.member_profiles;
      const priv = Array.isArray(row.member_private) ? row.member_private[0] : row.member_private;
      return {
        id: row.id as string,
        status: row.status as string,
        publicNumber: row.public_number as string,
        memberSince: row.member_since as string,
        createdAt: row.created_at as string,
        name: (profile?.display_name as string) ?? 'Unknown',
        slug: (profile?.profile_slug as string) ?? '',
        photo: profilePhotoUrl((profile?.profile_slug as string) ?? null),
        email: (priv?.email as string) ?? '',
      };
    })
    .filter((member) =>
      needle
        ? [member.name, member.email, member.publicNumber].some((value) =>
            value.toLowerCase().includes(needle),
          )
        : true,
    );

  return (
    <PageShell>
      <Flash notice={notice} error={error} />

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-overline text-primary">People</p>
          <h1 className="type-h2 mt-1">Members</h1>
        </div>
        <form method="get" className="flex w-full gap-2 sm:w-auto">
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search name, email, member no."
            aria-label="Search members"
            className="h-10 sm:w-72"
          />
          <Button type="submit" variant="secondary" size="sm" className="h-10 shrink-0">
            Search
          </Button>
        </form>
      </div>

      {members.length === 0 ? (
        <EmptyState
          title={needle ? 'No matches' : 'No active members yet'}
          description={
            needle
              ? 'Try a different name, email or member number.'
              : 'Accepted invitations appear here.'
          }
        />
      ) : (
        <DataTable
          caption="Members"
          rows={members}
          getRowKey={(row) => row.id}
          columns={[
            {
              key: 'member',
              header: 'Member',
              render: (row) => (
                <span className="flex items-center gap-3">
                  <MemberAvatar name={row.name} photoUrl={row.photo} size={38} />
                  <span className="min-w-0">
                    <Link
                      href={`/admin/members/${row.id}`}
                      className="block truncate text-sm font-semibold underline-offset-2 hover:text-primary hover:underline"
                    >
                      {row.name}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.email}
                    </span>
                  </span>
                </span>
              ),
            },
            {
              key: 'number',
              header: 'Member no.',
              render: (row) => (
                <span className="font-mono text-xs text-muted-foreground">{row.publicNumber}</span>
              ),
            },
            {
              key: 'since',
              header: 'Member since',
              render: (row) => <span className="text-sm">{formatDate(row.memberSince)}</span>,
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => <StatusChip status={row.status} />,
            },
            {
              key: 'open',
              header: '',
              align: 'right',
              render: (row) => (
                <Link
                  href={`/admin/members/${row.id}`}
                  className={buttonVariants({ size: 'sm', variant: 'secondary' })}
                >
                  Manage
                </Link>
              ),
            },
          ]}
        />
      )}
    </PageShell>
  );
}
