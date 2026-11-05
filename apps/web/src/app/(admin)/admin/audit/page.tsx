import type { Metadata } from 'next';
import { Button, DataTable, EmptyState, Field, PageShell, Select } from '@gdg/ui';
import { requireSuperadmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';
import { AUDIT_TOPICS, auditSentence } from '@/lib/audit/describe';
import { loadAuditNames } from '@/lib/audit/names';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Audit log',
  robots: { index: false, follow: false },
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ about?: string }>;
}) {
  const viewer = await requireSuperadmin();
  const { about = '' } = await searchParams;
  const admin = createSupabaseAdmin();
  const topic = AUDIT_TOPICS.find((item) => item.value === about);

  let query = admin
    .from('audit_log')
    .select('id, actor_auth_id, action, target_type, target_id, reason, after, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (topic) {
    query = query.or(topic.prefixes.map((prefix) => `action.like.${prefix}*`).join(','));
  }

  const { data } = await query;
  const rows = data ?? [];
  const names = await loadAuditNames(admin, rows);

  return (
    <PageShell>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-overline text-primary">Kept for good</p>
          <h1 className="type-h1 mt-2">Audit log</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            What organizers and members did, newest first. Nothing here can be changed or removed.
          </p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <Field label="Show" htmlFor="audit-topic" className="w-60">
            <Select
              id="audit-topic"
              name="about"
              defaultValue={topic?.value ?? ''}
              className="h-10"
            >
              <option value="">Everything</option>
              {AUDIT_TOPICS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary" className="h-10">
            Show
          </Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing recorded here yet"
          description="Actions appear as they happen."
        />
      ) : (
        <DataTable
          caption="Audit log entries"
          rows={rows}
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
              key: 'what',
              header: 'What happened',
              render: (row) => (
                <span className="text-sm">
                  {auditSentence(
                    row.actor_auth_id === viewer.user.id ? 'You' : (names.actor(row) ?? 'Someone'),
                    row,
                    names.target(row),
                  )}
                </span>
              ),
            },
            {
              key: 'reason',
              header: 'Reason given',
              render: (row) => (
                <span className="text-xs">{(row.reason as string | null) ?? '—'}</span>
              ),
            },
          ]}
        />
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        The newest 200 entries. Passwords, sign-in links and card links are never recorded.
      </p>
    </PageShell>
  );
}
