import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Gift, Mail, ScanLine, Users } from 'lucide-react';
import { buttonVariants, Card, CardContent, MetricCard, PageShell } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin overview',
  robots: { index: false, follow: false },
};

export default async function AdminOverviewPage() {
  await requireAdmin();
  const admin = createSupabaseAdmin();

  const [members, invites, scans, jobs, redemptions, rewards, recentAudit] = await Promise.all([
    admin.from('members').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    admin
      .from('member_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    admin.from('device_scans').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    admin
      .from('card_write_jobs')
      .select('id', { count: 'exact', head: true })
      .in('status', ['queued', 'claimed']),
    admin
      .from('redemptions')
      .select('id', { count: 'exact', head: true })
      .in('status', ['requested', 'approved']),
    admin.from('rewards').select('id', { count: 'exact', head: true }).eq('is_active', true),
    admin
      .from('audit_log')
      .select('id, action, target_type, target_id, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  const readiness = [
    { label: 'Queued card writes', value: jobs.count ?? 0 },
    { label: 'Active rewards', value: rewards.count ?? 0 },
    { label: 'Pending scans', value: scans.count ?? 0 },
  ];

  return (
    <PageShell>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-overline text-primary">Organizer console</p>
          <h1 className="type-h1 mt-2">Event control</h1>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link href="/admin/kiosk" className={buttonVariants({})}>
            Open kiosk
          </Link>
          <Link href="/admin/events" className={buttonVariants({ variant: 'secondary' })}>
            Events
          </Link>
        </div>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Active members" value={members.count ?? 0} icon={<Users />} />
        <MetricCard label="Pending invitations" value={invites.count ?? 0} icon={<Mail />} />
        <MetricCard
          label="Pending scans"
          value={scans.count ?? 0}
          hint="Awaiting human confirmation"
          icon={<ScanLine />}
        />
        <MetricCard
          label="Open redemption requests"
          value={redemptions.count ?? 0}
          icon={<Gift />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="pt-5">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="type-h3">Recent actions</h2>
              <Link
                href="/admin/audit"
                className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-mr-2' })}
              >
                Full audit log
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>

            {(recentAudit.data ?? []).length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">No admin actions recorded yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {(recentAudit.data ?? []).map((row) => (
                  <li
                    key={row.id as number}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5"
                  >
                    <span className="w-[8.6rem] shrink-0 font-mono text-[0.7rem] tabular-nums text-muted-foreground">
                      {formatDateTime(row.created_at as string)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {row.action as string}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.target_type as string}
                        {row.reason ? ` · ${row.reason as string}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <h2 className="type-h3">Event readiness</h2>
            <dl className="mt-3 divide-y divide-border">
              {readiness.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-sm text-muted-foreground">{item.label}</dt>
                  <dd className="font-mono text-sm font-semibold tabular-nums">{item.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Card writes and kiosk confirmations require a human in the loop. Points are never
              granted by a tap alone.
            </p>
            <Link
              href="/admin/devices"
              className={buttonVariants({ variant: 'soft', size: 'sm', className: 'mt-3' })}
            >
              Device health
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
