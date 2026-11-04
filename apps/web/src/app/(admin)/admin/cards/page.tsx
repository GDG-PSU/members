import type { Metadata } from 'next';
import Link from 'next/link';
import {
  buttonVariants,
  Card,
  CardContent,
  DataTable,
  EmptyState,
  PageShell,
  StatusChip,
} from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';
import { revokeCardAction } from '@/app/(admin)/admin/actions';
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

  const { data: cards } = await admin
    .from('card_credentials')
    .select(
      'id, member_id, status, issued_at, revoked_at, revoke_reason, created_at, members(public_number, member_profiles(display_name))',
    )
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <PageShell className="pb-10">
      <Flash notice={notice} error={error} />
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
          <div>
            <p className="type-overline text-primary">USB card lane</p>
            <h1 className="type-h3 mt-1.5">Cards</h1>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Prepare a pending URL on the USB page, write it with the local reader, then activate
              it after a matching read-back.
            </p>
          </div>
          <Link href="/admin/usb" className={buttonVariants()}>
            Open USB writer
          </Link>
        </CardContent>
      </Card>

      <h2 className="type-h3 mb-3">Card credentials</h2>
      {!cards || cards.length === 0 ? (
        <EmptyState
          title="No cards prepared"
          description="Prepare one for an active member on the USB page."
        />
      ) : (
        <DataTable
          caption="Card credentials"
          rows={cards}
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
    </PageShell>
  );
}
