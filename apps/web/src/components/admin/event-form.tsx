import { Input, Select, Textarea, Field } from '@gdg/ui';
import { saveEventAction } from '@/app/(admin)/admin/actions';
import { SubmitButton } from '@/components/admin/ui';
import { formatDateTimeLocalInput } from '@/lib/format';

export interface EventSessionValues {
  id: string;
  name: string;
  kind: 'main' | 'bonus';
  startsAt: string;
  endsAt: string;
  checkInOpensAt: string;
  checkInClosesAt: string;
  checkOutOpensAt: string;
  checkOutClosesAt: string;
  minimumDurationMinutes: number;
  rewardPoints: number;
}

export interface EventValues {
  id?: string;
  name: string;
  slug: string;
  summary: string;
  location: string;
  startsAt: string;
  endsAt: string;
  status: string;
  isPublic: boolean;
  sessions: EventSessionValues[];
}

const blankSession: EventSessionValues = {
  id: '',
  name: '',
  kind: 'main',
  startsAt: '',
  endsAt: '',
  checkInOpensAt: '',
  checkInClosesAt: '',
  checkOutOpensAt: '',
  checkOutClosesAt: '',
  minimumDurationMinutes: 30,
  rewardPoints: 10,
};

function local(value: string | undefined): string {
  if (!value) return '';
  try {
    return formatDateTimeLocalInput(value);
  } catch {
    return '';
  }
}

function SessionFields({
  prefix,
  label,
  session,
  optional = false,
}: {
  prefix: 'main' | 'bonus';
  label: string;
  session?: EventSessionValues;
  optional?: boolean;
}) {
  const value = session ?? blankSession;
  return (
    <fieldset className="rounded-2xl border border-border bg-subtle/50 p-4">
      <legend className="px-1 text-sm font-bold">{label}</legend>
      <input type="hidden" name={`${prefix}Id`} value={value.id} />
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Session name" htmlFor={`${prefix}Name`}>
            <Input
              id={`${prefix}Name`}
              name={`${prefix}Name`}
              defaultValue={value.name}
              required={!optional}
              maxLength={80}
            />
          </Field>
        </div>
        <Field label="Min. minutes" htmlFor={`${prefix}MinDuration`}>
          <Input
            id={`${prefix}MinDuration`}
            name={`${prefix}MinDuration`}
            type="number"
            defaultValue={value.minimumDurationMinutes}
            required={!optional}
            min={0}
            max={1440}
          />
        </Field>
        <Field label="Points" htmlFor={`${prefix}Reward`}>
          <Input
            id={`${prefix}Reward`}
            name={`${prefix}Reward`}
            type="number"
            defaultValue={value.rewardPoints}
            required={!optional}
            min={0}
            max={10000}
          />
        </Field>
        {(
          [
            ['StartsAt', 'Starts', value.startsAt],
            ['EndsAt', 'Ends', value.endsAt],
            ['CheckInOpensAt', 'Check-in opens', value.checkInOpensAt],
            ['CheckInClosesAt', 'Check-in closes', value.checkInClosesAt],
            ['CheckOutOpensAt', 'Check-out opens', value.checkOutOpensAt],
            ['CheckOutClosesAt', 'Check-out closes', value.checkOutClosesAt],
          ] as const
        ).map(([key, fieldLabel, fieldValue]) => {
          const id = `${prefix}${key}`;
          return (
            <Field key={key} label={`${fieldLabel} (ET)`} htmlFor={id}>
              <Input
                id={id}
                name={id}
                type="datetime-local"
                defaultValue={local(fieldValue)}
                required={!optional || Boolean(value.name)}
              />
            </Field>
          );
        })}
      </div>
    </fieldset>
  );
}

export function EventForm({ event, returnTo }: { event?: EventValues; returnTo: string }) {
  const main = event?.sessions.find((session) => session.kind === 'main');
  const bonus = event?.sessions.find((session) => session.kind === 'bonus');
  return (
    <form action={saveEventAction} className="space-y-6" noValidate>
      <input type="hidden" name="returnTo" value={returnTo} />
      {event?.id ? <input type="hidden" name="eventId" value={event.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Event name" htmlFor="event-name" required>
            <Input
              id="event-name"
              name="name"
              defaultValue={event?.name}
              required
              maxLength={120}
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Slug" htmlFor="event-slug" required hint="lowercase-words-with-dashes">
            <Input id="event-slug" name="slug" defaultValue={event?.slug} required />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Summary" htmlFor="event-summary">
            <Textarea
              id="event-summary"
              name="summary"
              defaultValue={event?.summary}
              maxLength={400}
              rows={2}
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Location" htmlFor="event-location">
            <Input
              id="event-location"
              name="location"
              defaultValue={event?.location}
              maxLength={160}
            />
          </Field>
        </div>
        <Field label="Status" htmlFor="event-status">
          <Select id="event-status" name="status" defaultValue={event?.status ?? 'draft'}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
          </Select>
        </Field>
        <div className="flex items-end pb-2.5">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
            <input
              type="checkbox"
              name="isPublic"
              defaultChecked={event?.isPublic ?? true}
              className="size-4 rounded border-input accent-primary"
            />
            Public listing
          </label>
        </div>
        <Field label="Event starts (ET)" htmlFor="event-starts">
          <Input
            id="event-starts"
            name="startsAt"
            type="datetime-local"
            defaultValue={local(event?.startsAt)}
            required
          />
        </Field>
        <Field label="Event ends (ET)" htmlFor="event-ends">
          <Input
            id="event-ends"
            name="endsAt"
            type="datetime-local"
            defaultValue={local(event?.endsAt)}
            required
          />
        </Field>
      </div>

      <SessionFields prefix="main" label="Main session" session={main} />
      <SessionFields prefix="bonus" label="Bonus session (optional)" session={bonus} optional />

      <p className="text-xs leading-relaxed text-muted-foreground">
        Times are interpreted as America/New_York wall-clock. Rewards are snapshotted onto each
        attendance record when checkout is confirmed, so later edits never rewrite history.
      </p>
      <SubmitButton pendingLabel="Saving event…">
        {event?.id ? 'Save changes' : 'Create event'}
      </SubmitButton>
    </form>
  );
}
