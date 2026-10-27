import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { EmptyState, MemberAvatar, MetricCard, StatusChip } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { publicPhotoUrl } from '@/lib/profile/photo';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  adjustMemberPointsAction,
  correctAttendanceAction,
  prepareCardAction,
  revokeCardAction,
  setMemberStatusAction,
} from '@/app/(admin)/admin/actions';
import { Flash, SubmitButton } from '@/components/admin/ui';
import { RecoveryForm } from '@/components/admin/recovery-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Member detail',
  robots: { index: false, follow: false },
};

export default async function AdminMemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { notice, error } = await searchParams;
  const admin = createSupabaseAdmin();
  const returnTo = `/admin/members/${id}`;

  const { data: row } = await admin
    .from('members')
    .select(
      'id, status, public_number, member_since, created_at, member_profiles(profile_slug, display_name, photo_path), member_private(email, admin_note)',
    )
    .eq('id', id)
    .maybeSingle();
  if (!row) notFound();

  const profile = Array.isArray(row.member_profiles) ? row.member_profiles[0] : row.member_profiles;
  const priv = Array.isArray(row.member_private) ? row.member_private[0] : row.member_private;

  const [balances, ledger, attendance, cards, writerDevices] = await Promise.all([
    admin.from('member_balances').select('points, stars').eq('member_id', id).maybeSingle(),
    admin
      .from('point_ledger')
      .select('id, delta, kind, description, created_at')
      .eq('member_id', id)
      .order('created_at', { ascending: false })
      .limit(12),
    admin
      .from('attendance_records')
      .select(
        'id, state, qualified, reward_points, checked_in_at, checked_out_at, duration_minutes, event_sessions(name, kind, events(name))',
      )
      .eq('member_id', id)
      .order('checked_in_at', { ascending: false })
      .limit(8),
    admin
      .from('card_credentials')
      .select('id, status, issued_at, created_at, revoke_reason')
      .eq('member_id', id)
      .order('created_at', { ascending: false }),
    admin.from('devices').select('id, device_id, lane_label, mode, status').eq('mode', 'writer').eq('status', 'active'),
  ]);

  const activeCard = (cards.data ?? []).find((card) => card.status === 'active');
  const points = balances.data?.points ?? 0;
  const stars = balances.data?.stars ?? 0;

  return (
    <Container maxWidth="xl" sx={{ pb: 8 }}>
      <Flash notice={notice} error={error} />
      <Button component="a" href="/admin/members" size="small" sx={{ mb: 2 }}>
        ← All members
      </Button>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card sx={{ mb: 3 }}>
            <CardContent sx={{ p: 3 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} sx={{ alignItems: { sm: 'center' } }}>
                <MemberAvatar name={(profile?.display_name as string) ?? 'Member'} photoUrl={publicPhotoUrl((profile?.photo_path as string) ?? null)} size={72} />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="h3">{profile?.display_name ?? 'Member'}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {priv?.email ?? 'no email'} · {row.public_number as string} · joined{' '}
                    {formatDate(row.member_since as string)}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <StatusChip status={row.status as string} />
                    {profile?.profile_slug ? (
                      <Chip
                        size="small"
                        label={`/m/${profile.profile_slug}`}
                        component="a"
                        href={`/m/${profile.profile_slug}`}
                        clickable
                        variant="outlined"
                      />
                    ) : null}
                  </Stack>
                </Box>
              </Stack>
              {priv?.admin_note ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  Note: {priv.admin_note as string}
                </Typography>
              ) : null}
            </CardContent>
          </Card>

          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 6, md: 3 }}>
              <MetricCard label="Points" value={points} />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <MetricCard label="Stars" value={stars} />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <MetricCard label="Cards" value={(cards.data ?? []).length} />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <MetricCard label="Attendance" value={(attendance.data ?? []).length} hint="recent" />
            </Grid>
          </Grid>

          <Card sx={{ mb: 3 }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h5" sx={{ mb: 2 }}>
                Recent attendance
              </Typography>
              {(attendance.data ?? []).length === 0 ? (
                <EmptyState title="No attendance records" />
              ) : (
                <Stack spacing={2} divider={<Divider flexItem />}>
                  {(attendance.data ?? []).map((record) => {
                    const session = Array.isArray(record.event_sessions) ? record.event_sessions[0] : record.event_sessions;
                    const event = Array.isArray(session?.events) ? session.events[0] : session?.events;
                    return (
                      <Stack key={record.id as string} direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="subtitle2">
                            {(event?.name as string) ?? 'Event'} · {(session?.name as string) ?? 'Session'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDateTime(record.checked_in_at as string)} →{' '}
                            {record.checked_out_at ? formatDateTime(record.checked_out_at as string) : 'no check-out'}
                            {record.duration_minutes !== null ? ` · ${record.duration_minutes as number} min` : ''}
                          </Typography>
                        </Box>
                        <StatusChip status={record.qualified ? 'qualified' : (record.state as string)} />
                        <Box component="form" action={correctAttendanceAction} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="attendanceId" value={record.id as string} />
                          <TextField
                            name="checkedOutAt"
                            type="datetime-local"
                            size="small"
                            label="Check-out (NY)"
                            slotProps={{ inputLabel: { shrink: true } }}
                          />
                          <TextField name="reason" size="small" label="Reason" required slotProps={{ htmlInput: { minLength: 5 } }} />
                          <TextField select name="action" size="small" label="Action" defaultValue={record.qualified ? 'disqualify' : 'set_checkout'}>
                            <MenuItem value="set_checkout">Set check-out</MenuItem>
                            <MenuItem value="clear_checkout">Clear check-out</MenuItem>
                            <MenuItem value="qualify">Qualify</MenuItem>
                            <MenuItem value="disqualify">Disqualify</MenuItem>
                          </TextField>
                          <SubmitButton size="small" variant="outlined" pendingLabel="Applying…">
                            Apply
                          </SubmitButton>
                        </Box>
                      </Stack>
                    );
                  })}
                </Stack>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h5" sx={{ mb: 2 }}>
                Points ledger
              </Typography>
              {(ledger.data ?? []).length === 0 ? (
                <EmptyState title="No ledger entries" />
              ) : (
                <Stack spacing={1.5} divider={<Divider flexItem />}>
                  {(ledger.data ?? []).map((entry) => (
                    <Stack key={entry.id as number} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="subtitle2">{entry.description as string}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {entry.kind as string} · {formatDateTime(entry.created_at as string)}
                        </Typography>
                      </Box>
                      <Typography
                        variant="subtitle2"
                        sx={{ fontVariantNumeric: 'tabular-nums', color: (entry.delta as number) > 0 ? 'success.main' : 'text.primary' }}
                      >
                        {(entry.delta as number) > 0 ? '+' : ''}
                        {entry.delta as number}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={2.5}>
            <Card>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ mb: 2 }}>
                  Award interaction points
                </Typography>
                <Stack component="form" action={adjustMemberPointsAction} spacing={1.5}>
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="memberId" value={id} />
                  <TextField name="points" type="number" label="Points" required slotProps={{ htmlInput: { min: 1, max: 10000 } }} />
                  <TextField name="reason" label="Reason (audited)" required slotProps={{ htmlInput: { minLength: 3, maxLength: 300 } }} />
                  <SubmitButton size="small" pendingLabel="Awarding…">
                    Award points + stars
                  </SubmitButton>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ mb: 2 }}>
                  Membership status
                </Typography>
                <Stack component="form" action={setMemberStatusAction} spacing={1.5}>
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="memberId" value={id} />
                  <TextField select name="status" label="Status" defaultValue={row.status as string} size="small">
                    <MenuItem value="active">Active</MenuItem>
                    <MenuItem value="suspended">Suspended</MenuItem>
                    <MenuItem value="archived">Archived</MenuItem>
                  </TextField>
                  <TextField name="reason" label="Reason (audited)" required slotProps={{ htmlInput: { minLength: 3, maxLength: 300 } }} />
                  <SubmitButton size="small" variant="outlined" pendingLabel="Saving…">
                    Update status
                  </SubmitButton>
                </Stack>
                <Divider sx={{ my: 2 }} />
                <Typography variant="caption" color="text.secondary">
                  Suspending blocks member API use immediately; already-issued JWTs are re-checked against
                  server-side role and member state.
                </Typography>
              </CardContent>
            </Card>

            <Card>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  Cards
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  Cards contain only an opaque URL. Issuing a new card revokes the previous one; the profile
                  URL never changes.
                </Typography>
                <Stack spacing={1} sx={{ mb: 2 }}>
                  {(cards.data ?? []).map((card) => (
                    <Stack key={card.id as string} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <StatusChip status={card.status as string} />
                      <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                        {card.issued_at ? `Issued ${formatDate(card.issued_at as string)}` : 'Not written'}
                      </Typography>
                      {card.status === 'active' ? (
                        <Box component="form" action={revokeCardAction}>
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="cardId" value={card.id as string} />
                          <input type="hidden" name="reason" value="Reported lost or replaced by organizer" />
                          <SubmitButton
                            size="small"
                            variant="text"
                            color="error"
                            confirmMessage="Revoke this card? The old /c link stops working."
                          >
                            Revoke
                          </SubmitButton>
                        </Box>
                      ) : null}
                    </Stack>
                  ))}
                  {(cards.data ?? []).length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No card prepared yet.
                    </Typography>
                  ) : null}
                </Stack>
                <Box component="form" action={prepareCardAction}>
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="memberId" value={id} />
                  <Stack spacing={1.5}>
                    <TextField select name="deviceId" label="Writer lane" size="small" required defaultValue="">
                      {(writerDevices.data ?? []).length === 0 ? (
                        <MenuItem value="" disabled>
                          No active writer device
                        </MenuItem>
                      ) : (
                        (writerDevices.data ?? []).map((device) => (
                          <MenuItem key={device.id as string} value={device.id as string}>
                            {device.lane_label as string} ({device.device_id as string})
                          </MenuItem>
                        ))
                      )}
                    </TextField>
                    <TextField name="reason" label="Reason (optional)" size="small" />
                    <SubmitButton
                      size="small"
                      pendingLabel="Queuing…"
                      confirmMessage="This replaces any existing pending card and queues a write job on that lane."
                    >
                      Prepare card + queue write
                    </SubmitButton>
                  </Stack>
                </Box>
                {activeCard ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                    Active card issued {activeCard.issued_at ? formatDate(activeCard.issued_at as string) : 'recently'}.
                  </Typography>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  Account recovery
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  Generates a one-time Supabase link for the registered address. No email is sent; copy
                  the link and deliver it privately. It is never stored or logged.
                </Typography>
                <RecoveryForm email={(priv?.email as string) ?? ''} />
              </CardContent>
            </Card>
          </Stack>
        </Grid>
      </Grid>
    </Container>
  );
}
