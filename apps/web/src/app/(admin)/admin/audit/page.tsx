import type { Metadata } from 'next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataTable, EmptyState } from '@gdg/ui';
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
    <Container maxWidth="xl" sx={{ pb: 8 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mb: 3 }}>
        <Box>
          <Typography variant="overline" color="primary">
            Immutable
          </Typography>
          <Typography variant="h2" component="h1" sx={{ fontSize: { xs: '2rem', md: '2.5rem' } }}>
            Audit log
          </Typography>
          <Typography color="text.secondary">Append-only record of organizer and security actions.</Typography>
        </Box>
        <Box component="form" method="get" sx={{ display: 'flex', gap: 1 }}>
          <TextField
            name="action"
            defaultValue={action}
            label="Filter action"
            size="small"
            placeholder="e.g. card or attendance"
            slotProps={{ htmlInput: { 'aria-label': 'Filter audit actions' } }}
          />
          <Button type="submit" variant="outlined">
            Filter
          </Button>
        </Box>
      </Stack>

      {!data || data.length === 0 ? (
        <EmptyState title="No matching audit entries" description="Actions appear here as organizers work." />
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
                <Typography variant="caption">{formatDateTime(row.created_at as string)}</Typography>
              ),
            },
            {
              key: 'action',
              header: 'Action',
              render: (row) => <Typography variant="subtitle2">{row.action as string}</Typography>,
            },
            {
              key: 'target',
              header: 'Target',
              render: (row) => (
                <Typography variant="caption" color="text.secondary">
                  {row.target_type as string}
                  {row.target_id ? ` · ${row.target_id as string}` : ''}
                </Typography>
              ),
            },
            {
              key: 'reason',
              header: 'Reason',
              render: (row) => (
                <Typography variant="caption">{(row.reason as string | null) ?? '—'}</Typography>
              ),
            },
            {
              key: 'actor',
              header: 'Actor',
              render: (row) => (
                <Typography variant="caption" color="text.secondary">
                  {(row.actor_auth_id as string | null)?.slice(0, 8) ?? 'system'}…
                </Typography>
              ),
            },
          ]}
        />
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        Audit rows cannot be updated or deleted (enforced by database triggers). Secrets, tokens and
        invitation links are never written here.
      </Typography>
    </Container>
  );
}
