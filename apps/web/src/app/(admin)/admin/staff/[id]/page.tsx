import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import {
  Badge,
  Card,
  CardContent,
  MemberAvatar,
  PageShell,
  StatusChip,
  buttonVariants,
} from '@gdg/ui';
import { requireSuperadmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { profilePhotoUrl } from '@/lib/profile/photo';
import { formatDate, formatDateTime } from '@/lib/format';
import { auditSentence } from '@/lib/audit/describe';
import { loadAuditNames } from '@/lib/audit/names';
import {
  changeUserRoleAction,
  deleteRecordAction,
  revokeCardAction,
  revokeUserAccessAction,
} from '@/app/(admin)/admin/actions';
import { Flash } from '@/components/admin/ui';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { RecoveryForm } from '@/components/admin/recovery-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Organizer',
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything a superadmin can do to another organizer, in one place. */
export default async function AdminStaffDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const viewer = await requireSuperadmin();
  const { id } = await params;
  const { notice, error } = await searchParams;
  if (!UUID.test(id)) notFound();
  // Nobody changes their own type or access; their own page is their profile.
  if (id === viewer.user.id) redirect('/admin/profile');

  const admin = createSupabaseAdmin();
  const returnTo = `/admin/staff/${id}`;

  const [{ data: roles }, { data: member }, { data: authData }] = await Promise.all([
    admin
      .from('user_roles')
      .select('role, granted_at')
      .eq('auth_user_id', id)
      .in('role', ['admin', 'superadmin'])
      .is('revoked_at', null),
    admin
      .from('members')
      .select('id, kind, member_profiles(profile_slug, display_name, photo_path)')
      .eq('auth_user_id', id)
      .maybeSingle(),
    admin.auth.admin.getUserById(id),
  ]);
  if (!roles?.length) {
    // Someone who is a member now is managed on the member page.
    if (member?.kind === 'member') redirect(`/admin/members/${member.id as string}`);
    notFound();
  }

  const role = roles.some((row) => row.role === 'superadmin') ? 'superadmin' : 'admin';
  const since = roles.map((row) => row.granted_at as string).sort()[0];
  const profile = Array.isArray(member?.member_profiles)
    ? member.member_profiles[0]
    : member?.member_profiles;
  const email = authData.user?.email ?? '';
  const name = (profile?.display_name as string | undefined) ?? (email || 'This organizer');

  const [{ data: cards }, { data: setupAudit }, { data: recent }] = await Promise.all([
    member
      ? admin
          .from('card_credentials')
          .select('id, status, issued_at')
          .eq('member_id', member.id)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as { id: string; status: string; issued_at: string | null }[] }),
    admin
      .from('audit_log')
      .select('action')
      .in('action', ['admin.invited', 'auth.password_updated'])
      .eq('target_id', id),
    admin
      .from('audit_log')
      .select(
        'id, actor_auth_id, action, target_type, target_id, reason, before, after, created_at',
      )
      .eq('actor_auth_id', id)
      .order('created_at', { ascending: false })
      .limit(8),
  ]);
  // The same signal the People page uses: invited, and no password set since.
  const settingUp =
    (setupAudit ?? []).some((row) => row.action === 'admin.invited') &&
    !(setupAudit ?? []).some((row) => row.action === 'auth.password_updated');
  const actions = recent ?? [];
  const names = await loadAuditNames(admin, actions);
  const typeChange = { returnTo: '/admin/users', authUserId: id };

  return (
    <PageShell>
      <Flash notice={notice} error={error} />

      <Link
        href="/admin/users"
        className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-2 mb-4' })}
      >
        <ArrowLeft className="size-4" aria-hidden />
        Everyone
      </Link>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardContent className="pt-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <MemberAvatar
                  name={name}
                  photoUrl={
                    profile?.photo_path ? profilePhotoUrl(profile.profile_slug as string) : null
                  }
                  size={72}
                />
                <div className="min-w-0 flex-1">
                  <h1 className="type-h3">{name}</h1>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {email || 'no email'}
                    {since ? ` · organizer since ${formatDate(since)}` : ''}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Badge variant={role === 'superadmin' ? 'primary' : 'outline'}>
                      {role === 'superadmin' ? 'Superadmin' : 'Admin'}
                    </Badge>
                    {settingUp ? <Badge variant="warning">Still setting up</Badge> : null}
                    {profile?.profile_slug ? (
                      <Link href={`/m/${profile.profile_slug as string}`} className="rounded-full">
                        <Badge
                          variant="outline"
                          className="transition-colors hover:border-primary/40 hover:text-primary"
                        >
                          Public page
                        </Badge>
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <h2 className="mb-1 text-base font-bold">What they did lately</h2>
              {actions.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">Nothing recorded yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {actions.map((row) => (
                    <li key={row.id as number} className="py-2.5">
                      <p className="text-sm leading-snug">
                        {auditSentence(name, row, names.target(row))}
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
        </div>

        <div className="space-y-5">
          <Card>
            <CardContent className="pt-5">
              <h2 className="mb-1 text-sm font-bold">Type of user</h2>
              <p className="mb-3 text-[0.78rem] leading-relaxed text-muted-foreground">
                {role === 'superadmin'
                  ? 'A superadmin runs everything and manages other organizers.'
                  : 'An admin runs events, cards, invitations and rewards.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {role === 'admin' ? (
                  <ConfirmAction
                    action={changeUserRoleAction}
                    fields={{ ...typeChange, role: 'superadmin' }}
                    label="Make superadmin"
                    title={`Make ${name} a superadmin?`}
                    description="They will be able to manage other organizers, change anyone's type and read the full audit log."
                    confirmLabel="Yes, make them a superadmin"
                  />
                ) : (
                  <ConfirmAction
                    action={changeUserRoleAction}
                    fields={{ ...typeChange, role: 'admin' }}
                    label="Make admin"
                    title={`Make ${name} an admin?`}
                    description="They keep running events, cards and rewards, but can no longer manage other organizers or read the full audit log."
                    confirmLabel="Yes, make them an admin"
                  />
                )}
                <ConfirmAction
                  action={changeUserRoleAction}
                  fields={{ ...typeChange, role: 'member' }}
                  label="Make member"
                  destructive
                  title={`Make ${name} a member?`}
                  description="They lose organizer access straight away. A profile with a photo becomes a member profile and the card keeps working. Without a photo the profile is removed, and they set one up the next time they sign in."
                  confirmLabel="Yes, make them a member"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <h2 className="mb-1 text-sm font-bold">Their card</h2>
              <p className="mb-3 text-[0.78rem] leading-relaxed text-muted-foreground">
                An organizer&apos;s card opens their public page. A new card replaces the old one.
              </p>
              <div className="mb-3 space-y-2">
                {(cards ?? []).map((card) => (
                  <div key={card.id as string} className="flex items-center gap-2">
                    <StatusChip status={card.status as string} />
                    <p className="min-w-0 flex-1 truncate text-[0.72rem] text-muted-foreground">
                      {card.issued_at
                        ? `Written ${formatDate(card.issued_at as string)}`
                        : 'Not written'}
                    </p>
                    {card.status === 'active' ? (
                      <ConfirmAction
                        action={revokeCardAction}
                        fields={{
                          returnTo,
                          cardId: card.id as string,
                          reason: 'Reported lost or replaced by organizer',
                        }}
                        label="Switch off"
                        variant="ghost"
                        destructive
                        title={`Switch off ${name}'s card?`}
                        description="Tapping it will no longer open their page. Their public page itself is unchanged."
                        confirmLabel="Yes, switch it off"
                      />
                    ) : null}
                  </div>
                ))}
                {(cards ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No card yet.</p>
                ) : null}
              </div>
              {member ? (
                <Link
                  href={`/admin/cards?member=${member.id as string}`}
                  className={buttonVariants({
                    variant: 'secondary',
                    size: 'sm',
                    className: 'w-full',
                  })}
                >
                  Write a card for them
                </Link>
              ) : (
                <p className="text-xs text-muted-foreground">
                  They can have a card once they have set up their profile.
                </p>
              )}
            </CardContent>
          </Card>

          {email ? (
            <Card>
              <CardContent className="pt-5">
                <h2 className="mb-1 text-sm font-bold">Password reset</h2>
                <p className="mb-3 text-[0.78rem] leading-relaxed text-muted-foreground">
                  Makes a one-time link that lets them choose a new password. It is never stored.
                </p>
                <RecoveryForm email={email} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="pt-5">
              <h2 className="mb-1 text-sm font-bold">Remove access</h2>
              <p className="mb-3 text-[0.78rem] leading-relaxed text-muted-foreground">
                Ends their organizer access and switches off their profile and card. Inviting them
                again brings both back.
              </p>
              <ConfirmAction
                action={revokeUserAccessAction}
                fields={{ returnTo: '/admin/users', authUserId: id }}
                label="Remove access"
                variant="destructive"
                destructive
                title={`Remove ${name}'s access?`}
                description="They are signed out of the admin area straight away, and their profile and card stop working."
                confirmLabel="Yes, remove access"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <h2 className="mb-1 text-sm font-bold">Delete account</h2>
              <p className="mb-3 text-[0.78rem] leading-relaxed text-muted-foreground">
                Removes their sign-in, profile, photo and card. To end their access but keep the
                account, use Remove access instead.
              </p>
              <ConfirmAction
                action={deleteRecordAction}
                fields={{ kind: 'user', id, returnTo: '/admin/users', failTo: returnTo }}
                label="Delete for good"
                variant="destructive"
                destructive
                title={`Delete ${name}'s account for good?`}
                description="Their sign-in, profile, photo and card are removed and cannot be brought back. What they did stays in the audit log, without their name."
                confirmLabel="Yes, delete the account"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
