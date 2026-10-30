import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  Field,
  Input,
  MemberAvatar,
  MetricCard,
  PageShell,
  Select,
  StatusChip,
  buttonVariants,
} from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { profilePhotoUrl } from '@/lib/profile/photo';
import { photoChangedWithin } from '@/lib/profile/identity';
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
      'id, status, public_number, member_since, created_at, member_profiles(profile_slug, display_name, photo_path, photo_changed_at), member_private(email, admin_note)',
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
    admin
      .from('devices')
      .select('id, device_id, lane_label, mode, status')
      .eq('mode', 'writer')
      .eq('status', 'active'),
  ]);

  const activeCard = (cards.data ?? []).find((card) => card.status === 'active');
  const points = balances.data?.points ?? 0;
  const stars = balances.data?.stars ?? 0;

  return (
    <PageShell>
      <Flash notice={notice} error={error} />

      <Link
        href="/admin/members"
        className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-2 mb-4' })}
      >
        <ArrowLeft className="size-4" aria-hidden />
        All members
      </Link>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardContent className="pt-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <MemberAvatar
                  name={(profile?.display_name as string) ?? 'Member'}
                  photoUrl={profilePhotoUrl((profile?.profile_slug as string) ?? null)}
                  size={72}
                />
                <div className="min-w-0 flex-1">
                  <h1 className="type-h3">{profile?.display_name ?? 'Member'}</h1>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {priv?.email ?? 'no email'} ·{' '}
                    <span className="font-mono text-xs">{row.public_number as string}</span> ·
                    joined {formatDate(row.member_since as string)}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <StatusChip status={row.status as string} />
                    {photoChangedWithin(profile?.photo_changed_at as string | undefined) ? (
                      <Badge variant="warning">Photo changed &lt;48h</Badge>
                    ) : null}
                    {profile?.profile_slug ? (
                      <Link href={`/m/${profile.profile_slug}`} className="rounded-full">
                        <Badge
                          variant="outline"
                          className="font-mono text-[0.7rem] transition-colors hover:border-primary/40 hover:text-primary"
                        >
                          /m/{profile.profile_slug as string}
                        </Badge>
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
              {priv?.admin_note ? (
                <p className="mt-4 rounded-xl border border-border bg-muted px-3 py-2 text-sm leading-relaxed text-muted-foreground">
                  Note: {priv.admin_note as string}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Points" value={points} />
            <MetricCard label="Stars" value={stars} />
            <MetricCard label="Cards" value={(cards.data ?? []).length} />
            <MetricCard label="Attendance" value={(attendance.data ?? []).length} hint="recent" />
          </div>

          <Card>
            <CardContent className="pt-5">
              <h2 className="mb-1 text-base font-bold">Recent attendance</h2>
              {(attendance.data ?? []).length === 0 ? (
                <EmptyState title="No attendance records" />
              ) : (
                <div className="divide-y divide-border">
                  {(attendance.data ?? []).map((record) => {
                    const session = Array.isArray(record.event_sessions)
                      ? record.event_sessions[0]
                      : record.event_sessions;
                    const event = Array.isArray(session?.events)
                      ? session.events[0]
                      : session?.events;
                    return (
                      <div key={record.id as string} className="flex flex-col gap-3 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">
                              {(event?.name as string) ?? 'Event'} ·{' '}
                              {(session?.name as string) ?? 'Session'}
                            </p>
                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                              {formatDateTime(record.checked_in_at as string)} →{' '}
                              {record.checked_out_at
                                ? formatDateTime(record.checked_out_at as string)
                                : 'no check-out'}
                              {record.duration_minutes !== null
                                ? ` · ${record.duration_minutes as number} min`
                                : ''}
                            </p>
                          </div>
                          <StatusChip
                            status={record.qualified ? 'qualified' : (record.state as string)}
                          />
                        </div>
                        <form
                          action={correctAttendanceAction}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="attendanceId" value={record.id as string} />
                          <Input
                            name="checkedOutAt"
                            type="datetime-local"
                            aria-label="Check-out (NY)"
                            className="h-9 w-[10.5rem] text-xs"
                          />
                          <Input
                            name="reason"
                            placeholder="Reason"
                            aria-label="Reason"
                            required
                            minLength={5}
                            className="h-9 w-32 text-xs"
                          />
                          <Select
                            name="action"
                            aria-label="Action"
                            defaultValue={record.qualified ? 'disqualify' : 'set_checkout'}
                            className="h-9 w-[9.5rem] text-xs"
                          >
                            <option value="set_checkout">Set check-out</option>
                            <option value="clear_checkout">Clear check-out</option>
                            <option value="qualify">Qualify</option>
                            <option value="disqualify">Disqualify</option>
                          </Select>
                          <SubmitButton size="small" variant="outlined" pendingLabel="Applying…">
                            Apply
                          </SubmitButton>
                        </form>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <h2 className="mb-1 text-base font-bold">Points ledger</h2>
              {(ledger.data ?? []).length === 0 ? (
                <EmptyState title="No ledger entries" />
              ) : (
                <div className="divide-y divide-border">
                  {(ledger.data ?? []).map((entry) => (
                    <div key={entry.id as number} className="flex items-center gap-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{entry.description as string}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {entry.kind as string} · {formatDateTime(entry.created_at as string)}
                        </p>
                      </div>
                      <p
                        className={`shrink-0 text-sm font-bold tabular-nums ${
                          (entry.delta as number) > 0 ? 'text-success' : 'text-foreground'
                        }`}
                      >
                        {(entry.delta as number) > 0 ? '+' : ''}
                        {entry.delta as number}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardContent className="pt-5">
              <h2 className="mb-3 text-sm font-bold">Award interaction points</h2>
              <form action={adjustMemberPointsAction} className="space-y-3">
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="memberId" value={id} />
                <Field label="Points" htmlFor="award-points">
                  <Input
                    id="award-points"
                    name="points"
                    type="number"
                    min={1}
                    max={10000}
                    required
                    className="h-10"
                  />
                </Field>
                <Field label="Reason (audited)" htmlFor="award-reason">
                  <Input
                    id="award-reason"
                    name="reason"
                    required
                    minLength={3}
                    maxLength={300}
                    className="h-10"
                  />
                </Field>
                <SubmitButton size="small" pendingLabel="Awarding…" className="w-full">
                  Award points + stars
                </SubmitButton>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <h2 className="mb-3 text-sm font-bold">Membership status</h2>
              <form action={setMemberStatusAction} className="space-y-3">
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="memberId" value={id} />
                <Field label="Status" htmlFor="member-status">
                  <Select
                    id="member-status"
                    name="status"
                    defaultValue={row.status as string}
                    className="h-10"
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="archived">Archived</option>
                  </Select>
                </Field>
                <Field label="Reason (audited)" htmlFor="status-reason">
                  <Input
                    id="status-reason"
                    name="reason"
                    required
                    minLength={3}
                    maxLength={300}
                    className="h-10"
                  />
                </Field>
                <SubmitButton
                  size="small"
                  variant="outlined"
                  pendingLabel="Saving…"
                  className="w-full"
                >
                  Update status
                </SubmitButton>
              </form>
              <div className="my-4 h-px bg-border" />
              <p className="text-[0.72rem] leading-relaxed text-muted-foreground">
                Suspension applies immediately and is re-checked server-side.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <h2 className="mb-1 text-sm font-bold">Cards</h2>
              <p className="mb-3 text-[0.72rem] leading-relaxed text-muted-foreground">
                A new card revokes the previous one. The profile URL never changes.
              </p>

              <div className="mb-3 space-y-2">
                {(cards.data ?? []).map((card) => (
                  <div key={card.id as string} className="flex items-center gap-2">
                    <StatusChip status={card.status as string} />
                    <p className="min-w-0 flex-1 truncate text-[0.72rem] text-muted-foreground">
                      {card.issued_at
                        ? `Issued ${formatDate(card.issued_at as string)}`
                        : 'Not written'}
                    </p>
                    {card.status === 'active' ? (
                      <form action={revokeCardAction}>
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <input type="hidden" name="cardId" value={card.id as string} />
                        <input
                          type="hidden"
                          name="reason"
                          value="Reported lost or replaced by organizer"
                        />
                        <SubmitButton
                          size="small"
                          variant="text"
                          color="error"
                          pendingLabel="Revoking…"
                          confirmMessage="Revoke this card? The old /c link stops working."
                        >
                          Revoke
                        </SubmitButton>
                      </form>
                    ) : null}
                  </div>
                ))}
                {(cards.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No card prepared yet.</p>
                ) : null}
              </div>

              <form action={prepareCardAction} className="space-y-3">
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="memberId" value={id} />
                <Field label="Writer lane" htmlFor="writer-lane">
                  <Select
                    id="writer-lane"
                    name="deviceId"
                    required
                    defaultValue=""
                    className="h-10"
                  >
                    {(writerDevices.data ?? []).length === 0 ? (
                      <option value="" disabled>
                        No active writer device
                      </option>
                    ) : (
                      (writerDevices.data ?? []).map((device) => (
                        <option key={device.id as string} value={device.id as string}>
                          {device.lane_label as string} ({device.device_id as string})
                        </option>
                      ))
                    )}
                  </Select>
                </Field>
                <Field label="Reason (optional)" htmlFor="prepare-reason">
                  <Input id="prepare-reason" name="reason" className="h-10" />
                </Field>
                <SubmitButton
                  size="small"
                  pendingLabel="Queuing…"
                  confirmMessage="This replaces any existing pending card and queues a write job on that lane."
                  className="w-full"
                >
                  Prepare card + queue write
                </SubmitButton>
              </form>

              {activeCard ? (
                <p className="mt-3 text-[0.72rem] leading-relaxed text-muted-foreground">
                  Active card issued{' '}
                  {activeCard.issued_at ? formatDate(activeCard.issued_at as string) : 'recently'}.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <h2 className="mb-1 text-sm font-bold">Account recovery</h2>
              <p className="mb-3 text-[0.72rem] leading-relaxed text-muted-foreground">
                Creates a one-time link. Copy it privately; it is never stored.
              </p>
              <RecoveryForm email={(priv?.email as string) ?? ''} />
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
