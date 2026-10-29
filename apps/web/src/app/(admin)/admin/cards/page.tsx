import type { Metadata } from 'next';
import {
  Button,
  Card,
  CardContent,
  DataTable,
  EmptyState,
  Field,
  Input,
  PageShell,
  Select,
  StatusChip,
} from '@gdg/ui';
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
    <PageShell className="pb-10">
      <Flash notice={notice} error={error} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-8">
        <Card className="h-fit lg:sticky lg:top-24">
          <CardContent className="p-5 sm:p-6">
            <p className="type-overline text-primary">One card at a time</p>
            <h1 className="type-h3 mt-1.5">Prepare a card</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Generates a new opaque URL, revokes the previous card, and queues a single-use write
              job on the selected writer lane. The token is never displayed.
            </p>

            <form action={prepareCardAction} className="mt-4 space-y-3.5">
              <input type="hidden" name="returnTo" value={returnTo} />
              <Field label="Member" htmlFor="memberId" required>
                <Select id="memberId" name="memberId" required defaultValue="">
                  <option value="" disabled>
                    Select a member
                  </option>
                  {memberRows.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Writer lane" htmlFor="deviceId" required>
                <Select id="deviceId" name="deviceId" required defaultValue="">
                  {(writers.data ?? []).length === 0 ? (
                    <option value="" disabled>
                      No active writer lane
                    </option>
                  ) : (
                    (writers.data ?? []).map((device) => (
                      <option key={device.id as string} value={device.id as string}>
                        {device.lane_label as string} ({device.device_id as string})
                      </option>
                    ))
                  )}
                </Select>
              </Field>

              <Field label="Reason (optional)" htmlFor="reason">
                <Input id="reason" name="reason" />
              </Field>

              <SubmitButton pendingLabel="Queuing…">Queue write job</SubmitButton>
            </form>

            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              To enable writer mode, set the lane to Writer under Devices. That lane pauses
              attendance scanning while it writes.
            </p>
          </CardContent>
        </Card>

        <div className="min-w-0">
          <h2 className="type-h3 mb-3">Card credentials</h2>
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
                      <div>
                        <p className="text-sm font-semibold">
                          {(profile?.display_name as string) ?? 'Member'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {member?.public_number as string}
                        </p>
                      </div>
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
                    <span className="text-xs">
                      {row.issued_at ? formatDateTime(row.issued_at as string) : 'not written'}
                    </span>
                  ),
                },
                {
                  key: 'revoked',
                  header: 'Revoked',
                  render: (row) => (
                    <span className="text-xs text-muted-foreground">
                      {row.revoked_at ? formatDateTime(row.revoked_at as string) : '—'}
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  render: (row) =>
                    row.status === 'active' ? (
                      <form action={revokeCardAction}>
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
                      </form>
                    ) : null,
                },
              ]}
            />
          )}

          <h3 className="type-h3 mb-3 mt-8">Write jobs</h3>
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
                  return <span className="text-sm">{device?.lane_label as string}</span>;
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
                  <span className="text-xs">{formatDateTime(row.created_at as string)}</span>
                ),
              },
              {
                key: 'expires',
                header: 'Expires',
                render: (row) => (
                  <span className="text-xs">{formatDateTime(row.expires_at as string)}</span>
                ),
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (row) =>
                  ['queued', 'claimed'].includes(row.status as string) ? (
                    <form action={completeWriteJobAction}>
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <input type="hidden" name="jobId" value={row.id as string} />
                      <Button type="submit" size="sm" variant="ghost">
                        Cancel
                      </Button>
                    </form>
                  ) : null,
              },
            ]}
          />
        </div>
      </div>
    </PageShell>
  );
}
