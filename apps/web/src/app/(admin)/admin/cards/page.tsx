import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataTable, EmptyState, StatusChip } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';
import {
  completeWriteJobAction,
  prepareCardAction,
  revokeCardAction,
} from '@/app/(admin)/admin/actions';
import { Flash, SubmitButton } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cards',
  robots: { index: false, follow: false },
};

export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  await requireAdmin();
  const { notice, error } = await searchParams;
  const admin = createSupabaseAdmin();
  const returnTo = '/admin/cards';

  const [members, cards, jobs, writers] = await Promise.all([
    admin
      .from('members')
      .select('id, public_number, member_profiles(display_name)')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(300),
    admin
      .from('card_credentials')
      .select(
        'id, member_id, status, issued_at, revoked_at, revoke_reason, created_at, members(public_number, member_profiles(display_name))',
      )
      .order('created_at', { ascending: false })
      .limit(100),
    admin
      .from('card_write_jobs')
      .select('id, status, created_at, expires_at, failure_code, devices(lane_label)')
      .order('created_at', { ascending: false })
      .limit(30),
    admin
      .from('devices')
      .select('id, device_id, lane_label, status, mode')
      .eq('mode', 'writer')
      .eq('status', 'active'),
  ]);

  const memberRows = (members.data ?? []).map((row) => {
    const profile = Array.isArray(row.member_profiles)
      ? row.member_profiles[0]
      : row.member_profiles;
    return {
      id: row.id as string,
      label: `${(profile?.display_name as string) ?? 'Member'} · ${row.public_number as string}`,
    };
  });

  return (
    <Container maxWidth="xl" sx={{ pb: 8 }}>
      <Flash notice={notice} error={error} />
      <Grid container spacing={4}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ position: { md: 'sticky' }, top: { md: 96 } }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="overline" color="primary">
                One card at a time
              </Typography>
              <Typography variant="h4" sx={{ mb: 1 }}>
                Prepare a card
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Generates a new opaque URL, revokes the previous card, and queues a single-use write
                job on the selected writer lane. The token is never displayed.
              </Typography>
              <Stack component="form" action={prepareCardAction} spacing={2}>
                <input type="hidden" name="returnTo" value={returnTo} />
                <TextField
                  select
                  name="memberId"
                  label="Member"
                  required
                  size="small"
                  defaultValue=""
                >
                  {memberRows.map((member) => (
                    <MenuItem key={member.id} value={member.id}>
                      {member.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  name="deviceId"
                  label="Writer lane"
                  required
                  size="small"
                  defaultValue=""
                >
                  {(writers.data ?? []).length === 0 ? (
                    <MenuItem value="" disabled>
                      No active writer lane
                    </MenuItem>
                  ) : (
                    (writers.data ?? []).map((device) => (
                      <MenuItem key={device.id as string} value={device.id as string}>
                        {device.lane_label as string} ({device.device_id as string})
                      </MenuItem>
                    ))
                  )}
                </TextField>
                <TextField name="reason" label="Reason (optional)" size="small" />
                <SubmitButton pendingLabel="Queuing…">Queue write job</SubmitButton>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                To enable writer mode, set the lane to Writer under Devices. That lane pauses
                attendance scanning while it writes.
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }}>
          <Typography variant="h3" sx={{ mb: 2 }}>
            Card credentials
          </Typography>
          {!cards.data || cards.data.length === 0 ? (
            <EmptyState
              title="No cards prepared"
              description="Prepare a card for an active member."
            />
          ) : (
            <DataTable
              caption="Card credentials"
              rows={cards.data}
              getRowKey={(row) => row.id as string}
              columns={[
                {
                  key: 'member',
                  header: 'Member',
                  render: (row) => {
                    const member = Array.isArray(row.members) ? row.members[0] : row.members;
                    const profile = Array.isArray(member?.member_profiles)
                      ? member.member_profiles[0]
                      : member?.member_profiles;
                    return (
                      <Box>
                        <Typography variant="subtitle2">
                          {(profile?.display_name as string) ?? 'Member'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {member?.public_number as string}
                        </Typography>
                      </Box>
                    );
                  },
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (row) => <StatusChip status={row.status as string} />,
                },
                {
                  key: 'issued',
                  header: 'Issued',
                  render: (row) => (
                    <Typography variant="caption">
                      {row.issued_at ? formatDateTime(row.issued_at as string) : 'not written'}
                    </Typography>
                  ),
                },
                {
                  key: 'revoked',
                  header: 'Revoked',
                  render: (row) => (
                    <Typography variant="caption" color="text.secondary">
                      {row.revoked_at ? formatDateTime(row.revoked_at as string) : '—'}
                    </Typography>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  render: (row) =>
                    row.status === 'active' ? (
                      <Box component="form" action={revokeCardAction}>
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <input type="hidden" name="cardId" value={row.id as string} />
                        <input
                          type="hidden"
                          name="reason"
                          value="Reported lost or replaced by organizer"
                        />
                        <SubmitButton
                          size="small"
                          variant="text"
                          color="error"
                          confirmMessage="Revoke this card?"
                        >
                          Revoke
                        </SubmitButton>
                      </Box>
                    ) : null,
                },
              ]}
            />
          )}

          <Typography variant="h4" sx={{ mt: 4, mb: 2 }}>
            Write jobs
          </Typography>
          <DataTable
            caption="Card write jobs"
            rows={jobs.data ?? []}
            getRowKey={(row) => row.id as string}
            emptyMessage="No write jobs yet."
            columns={[
              {
                key: 'lane',
                header: 'Lane',
                render: (row) => {
                  const device = Array.isArray(row.devices) ? row.devices[0] : row.devices;
                  return <Typography variant="body2">{device?.lane_label as string}</Typography>;
                },
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => <StatusChip status={row.status as string} />,
              },
              {
                key: 'created',
                header: 'Queued',
                render: (row) => (
                  <Typography variant="caption">
                    {formatDateTime(row.created_at as string)}
                  </Typography>
                ),
              },
              {
                key: 'expires',
                header: 'Expires',
                render: (row) => (
                  <Typography variant="caption">
                    {formatDateTime(row.expires_at as string)}
                  </Typography>
                ),
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (row) =>
                  ['queued', 'claimed'].includes(row.status as string) ? (
                    <Box component="form" action={completeWriteJobAction}>
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <input type="hidden" name="jobId" value={row.id as string} />
                      <Button type="submit" size="small" color="inherit">
                        Cancel
                      </Button>
                    </Box>
                  ) : null,
              },
            ]}
          />
        </Grid>
      </Grid>
    </Container>
  );
}
