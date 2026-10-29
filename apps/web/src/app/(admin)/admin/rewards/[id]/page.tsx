import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, PageShell } from '@gdg/ui';
import { requireAdmin } from '@/lib/auth/viewer';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { RewardForm, type RewardValues } from '@/components/admin/reward-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Edit reward',
  robots: { index: false, follow: false },
};

export default async function EditRewardPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
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
    </PageShell>
  );
}
