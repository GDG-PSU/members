import { Field, Input, Textarea } from '@gdg/ui';
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
    <form action={saveRewardAction} className="space-y-4" noValidate>
      <input type="hidden" name="returnTo" value={returnTo} />
      {reward?.id ? <input type="hidden" name="rewardId" value={reward.id} /> : null}

      <Field label="Reward name" htmlFor="reward-name" required>
        <Input
          id="reward-name"
          name="name"
          defaultValue={reward?.name}
          required
          maxLength={80}
          placeholder="GDG sticker pack"
        />
      </Field>

      <Field label="Description" htmlFor="reward-description">
        <Textarea
          id="reward-description"
          name="description"
          defaultValue={reward?.description}
          maxLength={300}
          rows={2}
          placeholder="A short description members will see."
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Cost (points)" htmlFor="reward-cost" required>
          <Input
            id="reward-cost"
            name="costPoints"
            type="number"
            defaultValue={reward?.costPoints ?? 50}
            required
            min={1}
            max={10000}
            className="font-mono tabular-nums"
          />
        </Field>
        <Field label="Inventory" htmlFor="reward-inventory" hint="Blank = unlimited">
          <Input
            id="reward-inventory"
            name="inventory"
            type="number"
            defaultValue={reward?.inventory ?? ''}
            min={0}
            max={10000}
            className="font-mono tabular-nums"
          />
        </Field>
      </div>

      <Field label="Fulfillment note" htmlFor="reward-fulfillment">
        <Input
          id="reward-fulfillment"
          name="fulfillmentNote"
          defaultValue={reward?.fulfillmentNote}
          maxLength={300}
          placeholder="Where or how the member picks this up"
        />
      </Field>

      <label className="flex items-center gap-2.5 text-sm font-semibold">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={reward?.isActive ?? true}
          className="size-4 rounded border-input accent-primary"
        />
        Active
      </label>

      <SubmitButton pendingLabel="Saving…">
        {reward?.id ? 'Save reward' : 'Create reward'}
      </SubmitButton>
    </form>
  );
}
