import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Gift, Mail, MapPin, Users } from 'lucide-react';
import { buttonVariants, Card, CardContent, MetricCard, PageShell } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';
import { auditSentence } from '@/lib/audit/describe';
import { loadAuditNames } from '@/lib/audit/names';
import { Flash } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin home',
  robots: { index: false, follow: false },
};

function nowIso(): string {
  return new Date().toISOString();
}

function Tile({
  href,
  label,
  value,
  icon,
}: {
  href: string;
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block border border-transparent transition-colors hover:border-primary/40 focus-visible:border-primary focus-visible:outline-none"
    >
      <MetricCard label={label} value={value} icon={icon} />
    </Link>
  );
}

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const viewer = await requireAdmin();
  const { notice, error } = await searchParams;
  const admin = createSupabaseAdmin();

  let invitesQuery = admin
    .from('member_invitations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .gt('expires_at', nowIso());
  if (!viewer.isSuperadmin) {
    invitesQuery = invitesQuery.eq('created_by', viewer.user.id);
  }

  let auditQuery = admin
    .from('audit_log')
    .select('id, actor_auth_id, action, target_type, target_id, reason, before, after, created_at')
    .order('created_at', { ascending: false })
    .limit(8);
  if (!viewer.isSuperadmin) {
    auditQuery = auditQuery.eq('actor_auth_id', viewer.user.id);
  }

  const [members, invites, redemptions, recentAudit, nextEvent] = await Promise.all([
    admin
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .eq('kind', 'member'),
    invitesQuery,
    admin
      .from('redemptions')
      .select('id', { count: 'exact', head: true })
      .in('status', ['requested', 'approved']),
    auditQuery,
    admin
      .from('events')
      .select('id, name, starts_at, location')
      .eq('status', 'published')
      .gte('ends_at', nowIso())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const actions = recentAudit.data ?? [];
  const names = await loadAuditNames(admin, actions);

  return (
    <PageShell>
      <Flash notice={notice} error={error} />
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="type-overline text-primary">Organizers</p>
          <h1 className="type-h1 mt-2">Home</h1>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link href="/admin/kiosk" className={buttonVariants({})}>
            Open kiosk
          </Link>
          <Link href="/admin/cards" className={buttonVariants({ variant: 'secondary' })}>
            Write a card
          </Link>
          <Link href="/admin/users?invite=1" className={buttonVariants({ variant: 'secondary' })}>
            Invite someone
          </Link>
          <Link href="/admin/events/new" className={buttonVariants({ variant: 'secondary' })}>
            New event
          </Link>
        </div>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Tile
          href="/admin/users"
          label="Active members"
          value={members.count ?? 0}
          icon={<Users />}
        />
        <Tile
          href="/admin/users?q=invite+pending"
          label="Invitations waiting"
          value={invites.count ?? 0}
          icon={<Mail />}
        />
        <Tile
          href="/admin/rewards"
          label="Reward requests waiting"
          value={redemptions.count ?? 0}
          icon={<Gift />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="pt-5">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="type-h3">
                {viewer.isSuperadmin ? 'What happened lately' : 'What you did lately'}
              </h2>
              {viewer.isSuperadmin ? (
                <Link
                  href="/admin/audit"
                  className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-mr-2' })}
                >
                  Full audit log
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              ) : null}
            </div>

            {actions.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">Nothing has been recorded yet.</p>
            ) : (
              <ul className="divide-y divide-border" aria-label="Recent actions">
                {actions.map((row) => (
                  <li key={row.id as number} className="py-2.5">
                    <p className="text-sm leading-snug">
                      {auditSentence(
                        row.actor_auth_id === viewer.user.id
                          ? 'You'
                          : (names.actor(row) ?? 'Someone'),
                        row,
                        names.target(row),
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDateTime(row.created_at as string)}
                      {row.reason ? ` · ${row.reason as string}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <h2 className="type-h3">Next event</h2>
            {nextEvent.data ? (
              <>
                <p className="mt-3 text-sm font-semibold">{nextEvent.data.name as string}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {formatDateTime(nextEvent.data.starts_at as string)}
                </p>
                {nextEvent.data.location ? (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="size-3.5" aria-hidden />
                    {nextEvent.data.location as string}
                  </p>
                ) : null}
                <Link
                  href={`/admin/events/${nextEvent.data.id as string}`}
                  className={buttonVariants({ variant: 'soft', size: 'sm', className: 'mt-4' })}
                >
                  Open event
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Nothing is published. Members see an event once you publish it.
                </p>
                <Link
                  href="/admin/events"
                  className={buttonVariants({ variant: 'soft', size: 'sm', className: 'mt-4' })}
                >
                  See events
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
