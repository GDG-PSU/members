import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
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
    <Container maxWidth="sm" sx={{ pb: 8 }}>
      <Button component="a" href="/admin/rewards" size="small" sx={{ mb: 2 }}>
        ← Rewards
      </Button>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography variant="overline" color="primary">
          Catalogue
        </Typography>
        <Typography variant="h2" component="h1" sx={{ fontSize: { xs: '2rem', md: '2.5rem' } }}>
          {reward.name}
        </Typography>
      </Stack>
      <Card>
        <CardContent sx={{ p: 3 }}>
          <RewardForm reward={reward} returnTo={`/admin/rewards/${id}`} />
        </CardContent>
      </Card>
    </Container>
  );
}
