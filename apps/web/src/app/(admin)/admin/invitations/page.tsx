import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataTable, EmptyState, StatusChip } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDate, formatDateTime } from '@/lib/format';
import { createInvitationAction, invitationAction } from '@/app/(admin)/admin/actions';
import { Flash, SubmitButton } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Invitations',
  robots: { index: false, follow: false },
};

export default async function InvitationsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  await requireAdmin();
  const { notice, error } = await searchParams;
  const admin = createSupabaseAdmin();
  const { data: invitations } = await admin
    .from('member_invitations')
    .select('id, email, status, paid_since, note, created_at, expires_at, accepted_at')
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <Container maxWidth="xl" sx={{ pb: 8 }}>
      <Flash notice={notice} error={error} />
      <Grid container spacing={4}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ position: { md: 'sticky' }, top: { md: 96 } }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="overline" color="primary">
                Paid member
              </Typography>
              <Typography variant="h4" sx={{ mb: 1 }}>
                Invite a member
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                Record the date dues were paid, then send a Supabase invitation. No profile exists until
                the member completes setup.
              </Typography>
              <Stack component="form" action={createInvitationAction} spacing={2} noValidate>
                <input type="hidden" name="returnTo" value="/admin/invitations" />
                <TextField label="Email" name="email" type="email" required fullWidth autoComplete="off" />
                <TextField
                  label="Member since (paid date)"
                  name="paidSince"
                  type="date"
                  required
                  fullWidth
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField label="Internal note" name="note" fullWidth multiline minRows={2} slotProps={{ htmlInput: { maxLength: 300 } }} />
                <SubmitButton pendingLabel="Sending…">Send invitation</SubmitButton>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                Duplicate pending invitations are blocked. Invitations expire after 14 days and can be
                revoked or resent.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          <Typography variant="h3" sx={{ mb: 2 }}>
            Invitation history
          </Typography>
          {!invitations || invitations.length === 0 ? (
            <EmptyState title="No invitations yet" description="Invite the first paid member using the form." />
          ) : (
            <DataTable
              caption="Member invitations"
              rows={invitations}
              getRowKey={(row) => row.id as string}
              columns={[
                {
                  key: 'email',
                  header: 'Email',
                  render: (row) => (
                    <Box>
                      <Typography variant="subtitle2">{row.email as string}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Paid since {formatDate(row.paid_since as string)}
                        {row.accepted_at ? ` · accepted ${formatDate(row.accepted_at as string)}` : ''}
                      </Typography>
                    </Box>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (row) => <StatusChip status={row.status as string} />,
                },
                {
                  key: 'expires',
                  header: 'Created / expires',
                  render: (row) => (
                    <Box>
                      <Typography variant="caption">
                        {formatDateTime(row.created_at as string)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        → {formatDateTime(row.expires_at as string)}
                      </Typography>
                    </Box>
                  ),
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (row) =>
                    row.status === 'pending' ? (
                      <Stack direction="row" spacing={1}>
                        <Box component="form" action={invitationAction}>
                          <input type="hidden" name="returnTo" value="/admin/invitations" />
                          <input type="hidden" name="invitationId" value={row.id as string} />
                          <input type="hidden" name="action" value="resend" />
                          <SubmitButton size="small" variant="outlined" pendingLabel="Sending…">
                            Resend
                          </SubmitButton>
                        </Box>
                        <Box component="form" action={invitationAction}>
                          <input type="hidden" name="returnTo" value="/admin/invitations" />
                          <input type="hidden" name="invitationId" value={row.id as string} />
                          <input type="hidden" name="action" value="revoke" />
                          <SubmitButton
                            size="small"
                            variant="text"
                            color="error"
                            confirmMessage="Revoke this invitation? The link stops working."
                          >
                            Revoke
                          </SubmitButton>
                        </Box>
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        —
                      </Typography>
                    ),
                },
              ]}
            />
          )}
        </Grid>
      </Grid>
    </Container>
  );
}
