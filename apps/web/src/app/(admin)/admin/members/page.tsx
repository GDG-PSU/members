import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataTable, EmptyState, MemberAvatar, StatusChip } from '@gdg/ui';
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
    <Container maxWidth="xl" sx={{ pb: 8 }}>
      <Flash notice={notice} error={error} />
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mb: 3 }}
      >
        <Box>
          <Typography variant="overline" color="primary">
            People
          </Typography>
          <Typography variant="h2" component="h1" sx={{ fontSize: { xs: '2rem', md: '2.5rem' } }}>
            Members
          </Typography>
        </Box>
        <Box component="form" method="get" sx={{ display: 'flex', gap: 1 }}>
          <TextField
            name="q"
            defaultValue={q}
            placeholder="Search name, email, member no."
            size="small"
            sx={{ minWidth: { sm: 300 } }}
            slotProps={{ htmlInput: { 'aria-label': 'Search members' } }}
          />
          <Button type="submit" variant="outlined">
            Search
          </Button>
        </Box>
      </Stack>

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
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <MemberAvatar name={row.name} photoUrl={row.photo} size={38} />
                  <Box>
                    <Typography
                      variant="subtitle2"
                      component="a"
                      href={`/admin/members/${row.id}`}
                      sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                    >
                      {row.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.email}
                    </Typography>
                  </Box>
                </Stack>
              ),
            },
            {
              key: 'number',
              header: 'Member no.',
              render: (row) => <Typography variant="body2">{row.publicNumber}</Typography>,
            },
            {
              key: 'since',
              header: 'Member since',
              render: (row) => (
                <Typography variant="body2">{formatDate(row.memberSince)}</Typography>
              ),
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
                <Button component="a" href={`/admin/members/${row.id}`} size="small">
                  Manage
                </Button>
              ),
            },
          ]}
        />
      )}
    </Container>
  );
}
