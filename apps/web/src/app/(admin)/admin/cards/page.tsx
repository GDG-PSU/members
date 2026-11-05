import type { Metadata } from 'next';
import { DataTable, EmptyState, PageShell, SectionHeading, StatusChip } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';
import {
  deleteRecordAction,
  findCardHolderAction,
  revokeCardAction,
} from '@/app/(admin)/admin/actions';
import { Flash, SubmitButton } from '@/components/admin/ui';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { CardWriter } from '@/components/admin/card-writer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cards',
  robots: { index: false, follow: false },
};

const CARD_STATUS_LABELS: Record<string, string> = {
  pending: 'Not written yet',
  active: 'Working',
  revoked: 'Switched off',
  lost: 'Reported lost',
  replaced: 'Replaced',
};

export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; member?: string }>;
}) {
  const viewer = await requireAdmin();
  const { notice, error, member } = await searchParams;
  const returnTo = '/admin/cards';

  const [{ data: cards }, initialHolder] = await Promise.all([
    createSupabaseAdmin()
      .from('card_credentials')
      .select(
        'id, member_id, status, issued_at, revoked_at, created_at, members(kind, public_number, member_profiles(display_name))',
      )
      .order('created_at', { ascending: false })
      .limit(100),
    member ? findCardHolderAction(member) : Promise.resolve(null),
  ]);

  return (
    <PageShell className="pb-10">
      <Flash notice={notice} error={error} />
      <SectionHeading
        headingLevel={1}
        eyebrow="Cards"
        title="Write a card"
        description="Choose the person, place a card on the reader, and it is written, checked and switched on."
      />

      <CardWriter initialHolder={initialHolder} />

      <h2 className="type-h3 mb-3 mt-10">Cards issued</h2>
      {!cards || cards.length === 0 ? (
        <EmptyState title="No cards yet" description="The cards you write appear here." />
      ) : (
        <DataTable
          caption="Cards issued"
          rows={cards}
          getRowKey={(row) => row.id as string}
          columns={[
            {
              key: 'member',
              header: 'Person',
              render: (row) => {
                const holder = Array.isArray(row.members) ? row.members[0] : row.members;
                const profile = Array.isArray(holder?.member_profiles)
                  ? holder.member_profiles[0]
                  : holder?.member_profiles;
                return (
                  <div>
                    <p className="text-sm font-semibold">
                      {(profile?.display_name as string) ?? 'Member'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {holder?.kind === 'organizer'
                        ? 'Organizer'
                        : (holder?.public_number as string)}
                    </p>
                  </div>
                );
              },
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <StatusChip
                  status={row.status as string}
                  label={CARD_STATUS_LABELS[row.status as string]}
                />
              ),
            },
            {
              key: 'issued',
              header: 'Written',
              render: (row) => (
                <span className="text-xs">
                  {row.issued_at ? formatDateTime(row.issued_at as string) : '—'}
                </span>
              ),
            },
            {
              key: 'revoked',
              header: 'Stopped',
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
              render: (row) => {
                const holder = Array.isArray(row.members) ? row.members[0] : row.members;
                const profile = Array.isArray(holder?.member_profiles)
                  ? holder.member_profiles[0]
                  : holder?.member_profiles;
                const holderName = (profile?.display_name as string | undefined) ?? 'this person';
                return (
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {row.status === 'active' ? (
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
                          confirmMessage="Switch this card off? It stops working straight away. Use this when a card is lost."
                        >
                          Switch off
                        </SubmitButton>
                      </form>
                    ) : null}
                    {viewer.isSuperadmin ? (
                      <ConfirmAction
                        action={deleteRecordAction}
                        fields={{ kind: 'card', id: row.id as string, returnTo }}
                        label="Delete"
                        variant="ghost"
                        destructive
                        title={`Delete ${holderName}'s card for good?`}
                        description={
                          row.status === 'active'
                            ? 'The card stops working and its record is removed. To keep the record, switch it off instead.'
                            : 'The record of this card is removed and cannot be brought back.'
                        }
                        confirmLabel="Yes, delete it for good"
                      />
                    ) : null}
                  </div>
                );
              },
            },
          ]}
        />
      )}
    </PageShell>
  );
}
