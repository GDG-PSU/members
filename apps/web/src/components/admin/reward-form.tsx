import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { saveRewardAction } from '@/app/(admin)/admin/actions';
import { SubmitButton } from '@/components/admin/ui';

export interface RewardValues {
  id?: string;
  name: string;
  description: string;
  costPoints: number;
  inventory: number | null;
  isActive: boolean;
  fulfillmentNote: string;
}

export function RewardForm({ reward, returnTo }: { reward?: RewardValues; returnTo: string }) {
  return (
    <Stack component="form" action={saveRewardAction} spacing={2} noValidate>
      <input type="hidden" name="returnTo" value={returnTo} />
      {reward?.id ? <input type="hidden" name="rewardId" value={reward.id} /> : null}
      <TextField name="name" label="Reward name" defaultValue={reward?.name} required fullWidth slotProps={{ htmlInput: { maxLength: 80 } }} />
      <TextField
        name="description"
        label="Description"
        defaultValue={reward?.description}
        fullWidth
        multiline
        minRows={2}
        slotProps={{ htmlInput: { maxLength: 300 } }}
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 6 }}>
          <TextField
            name="costPoints"
            label="Cost (points)"
            type="number"
            defaultValue={reward?.costPoints ?? 50}
            required
            fullWidth
            slotProps={{ htmlInput: { min: 1, max: 10000 } }}
          />
        </Grid>
        <Grid size={{ xs: 6 }}>
          <TextField
            name="inventory"
            label="Inventory (blank = unlimited)"
            type="number"
            defaultValue={reward?.inventory ?? ''}
            fullWidth
            slotProps={{ htmlInput: { min: 0, max: 10000 } }}
          />
        </Grid>
      </Grid>
      <TextField
        name="fulfillmentNote"
        label="Fulfillment note"
        defaultValue={reward?.fulfillmentNote}
        fullWidth
        slotProps={{ htmlInput: { maxLength: 300 } }}
      />
      <FormControlLabel control={<Checkbox name="isActive" defaultChecked={reward?.isActive ?? true} />} label="Active" />
      <SubmitButton pendingLabel="Saving…">{reward?.id ? 'Save reward' : 'Create reward'}</SubmitButton>
    </Stack>
  );
}
