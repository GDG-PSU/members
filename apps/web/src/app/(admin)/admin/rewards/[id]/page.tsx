import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, PageShell } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { RewardForm, type RewardValues } from '@/components/admin/reward-form';
import { deleteRecordAction } from '@/app/(admin)/admin/actions';
import { Flash } from '@/components/admin/ui';
import { ConfirmAction } from '@/components/admin/confirm-action';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Edit reward',
  robots: { index: false, follow: false },
};

export default async function EditRewardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const viewer = await requireAdmin();
  const { id } = await params;
  const { notice, error } = await searchParams;
  const admin = createSupabaseAdmin();
  const { data } = await admin
    .from('rewards')
    .select('id, name, description, cost_points, inventory, is_active, fulfillment_note')
    .eq('id', id)
    .maybeSingle();
  if (!data) notFound();

  const reward: RewardValues = {
    id: data.id as string,
    name: data.name as string,
    description: (data.description as string) ?? '',
    costPoints: data.cost_points as number,
    inventory: (data.inventory as number | null) ?? null,
    isActive: Boolean(data.is_active),
    fulfillmentNote: (data.fulfillment_note as string) ?? '',
  };

  return (
    <PageShell width="md">
      <Flash notice={notice} error={error} />
      <Link
        href="/admin/rewards"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Rewards
      </Link>

      <div className="mb-6">
        <p className="type-overline text-primary">Catalogue</p>
        <h1 className="type-h1 mt-2">{reward.name}</h1>
      </div>

      <Card>
        <CardContent className="pt-5">
          <RewardForm reward={reward} returnTo={`/admin/rewards/${id}`} />
        </CardContent>
      </Card>

      {viewer.isSuperadmin ? (
        <Card className="mt-5">
          <CardContent className="pt-5">
            <h2 className="text-sm font-bold">Delete this reward</h2>
            <p className="mb-3 mt-1 text-xs leading-relaxed text-muted-foreground">
              To stop offering it but keep its history, switch it off above instead.
            </p>
            <ConfirmAction
              action={deleteRecordAction}
              fields={{
                kind: 'reward',
                id,
                returnTo: '/admin/rewards',
                failTo: `/admin/rewards/${id}`,
              }}
              label="Delete for good"
              variant="destructive"
              destructive
              title={`Delete ${reward.name} for good?`}
              description="The reward and the requests already handled for it are removed and cannot be brought back. Points members spent on it stay spent."
              confirmLabel="Yes, delete it for good"
            />
          </CardContent>
        </Card>
      ) : null}
    </PageShell>
  );
}
