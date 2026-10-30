import type { Metadata } from 'next';
import { DataTable, EmptyState, Field, Input, PageShell, Button } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Audit log',
  robots: { index: false, follow: false },
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  await requireAdmin();
  const { action = '' } = await searchParams;
  const admin = createSupabaseAdmin();

  let query = admin
    .from('audit_log')
    .select('id, actor_auth_id, action, target_type, target_id, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (action.trim()) {
    query = query.ilike('action', `%${action.trim()}%`);
  }

  const { data } = await query;

  return (
    <PageShell>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-overline text-primary">Immutable</p>
          <h1 className="type-h1 mt-2">Audit log</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Append-only record of organizer and security actions.
          </p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <Field label="Filter action" htmlFor="audit-action" className="w-56">
            <Input
              id="audit-action"
              name="action"
              defaultValue={action}
              placeholder="e.g. card or attendance"
              aria-label="Filter audit actions"
              className="h-10 text-sm"
            />
          </Field>
          <Button type="submit" variant="secondary" className="h-10">
            Filter
          </Button>
        </form>
      </div>

      {!data || data.length === 0 ? (
        <EmptyState title="No matching audit entries" description="Actions appear here." />
      ) : (
        <DataTable
          caption="Audit log entries"
          rows={data}
          getRowKey={(row) => String(row.id)}
          columns={[
            {
              key: 'when',
              header: 'When',
              render: (row) => (
                <span className="whitespace-nowrap font-mono text-[0.7rem] tabular-nums text-muted-foreground">
                  {formatDateTime(row.created_at as string)}
                </span>
              ),
            },
            {
              key: 'action',
              header: 'Action',
              render: (row) => (
                <span className="text-sm font-semibold">{row.action as string}</span>
              ),
            },
            {
              key: 'target',
              header: 'Target',
              render: (row) => (
                <span className="text-xs text-muted-foreground">
                  {row.target_type as string}
                  {row.target_id ? ` · ${row.target_id as string}` : ''}
                </span>
              ),
            },
            {
              key: 'reason',
              header: 'Reason',
              render: (row) => (
                <span className="text-xs">{(row.reason as string | null) ?? '—'}</span>
              ),
            },
            {
              key: 'actor',
              header: 'Actor',
              render: (row) => (
                <span className="font-mono text-xs text-muted-foreground">
                  {(row.actor_auth_id as string | null)?.slice(0, 8) ?? 'system'}…
                </span>
              ),
            },
          ]}
        />
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Append-only. Secrets and links are never logged.
      </p>
    </PageShell>
  );
}
