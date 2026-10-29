import type { Metadata } from 'next';
import { Card, CardContent, DataTable, EmptyState, PageShell, StatusChip } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDate, formatDateTime } from '@/lib/format';
import { revokeInvitationAction } from '@/app/(admin)/admin/actions';
import { Flash, SubmitButton } from '@/components/admin/ui';
import { InviteForm } from '@/components/admin/invite-form';
import { AdminInviteForm } from '@/components/admin/admin-invite-form';
import { RegenerateInvitationLink } from '@/components/admin/regenerate-invitation-link';

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
    <PageShell className="pb-10">
      <Flash notice={notice} error={error} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-8">
        <div className="space-y-6 lg:sticky lg:top-24 lg:h-fit">
          <Card>
            <CardContent className="p-5 sm:p-6">
              <p className="type-overline text-primary">Paid member</p>
              <h1 className="type-h3 mt-1.5">Invite a member</h1>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Record the date dues were paid, then generate a one-time invitation link and send it
                yourself. No profile exists until the member completes setup.
              </p>
              <div className="mt-4">
                <InviteForm />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5 sm:p-6">
              <p className="type-overline text-secondary">Staff access</p>
              <h2 className="type-h3 mt-1.5">Invite an administrator</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Grants the admin role and returns a one-time link. The invitee enrolls TOTP before
                the portal opens.
              </p>
              <div className="mt-4">
                <AdminInviteForm />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0">
          <h2 className="type-h3 mb-3">Invitation history</h2>
          {!invitations || invitations.length === 0 ? (
            <EmptyState
              title="No invitations yet"
              description="Invite the first paid member using the form."
            />
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
                    <div>
                      <p className="text-sm font-semibold">{row.email as string}</p>
                      <p className="text-xs text-muted-foreground">
                        Paid since {formatDate(row.paid_since as string)}
                        {row.accepted_at
                          ? ` · accepted ${formatDate(row.accepted_at as string)}`
                          : ''}
                      </p>
                    </div>
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
                    <div>
                      <p className="text-xs">{formatDateTime(row.created_at as string)}</p>
                      <p className="text-xs text-muted-foreground">
                        → {formatDateTime(row.expires_at as string)}
                      </p>
                    </div>
                  ),
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (row) =>
                    row.status === 'pending' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <RegenerateInvitationLink invitationId={row.id as string} />
                        <form action={revokeInvitationAction}>
                          <input type="hidden" name="returnTo" value="/admin/invitations" />
                          <input type="hidden" name="invitationId" value={row.id as string} />
                          <SubmitButton
                            size="small"
                            variant="text"
                            color="error"
                            confirmMessage="Revoke this invitation? The link stops working."
                          >
                            Revoke
                          </SubmitButton>
                        </form>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    ),
                },
              ]}
            />
          )}
        </div>
      </div>
    </PageShell>
  );
}
