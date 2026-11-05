'use client';

import { useActionState } from 'react';
import { Alert, Input, Select, Textarea, Field } from '@gdg/ui';
import { saveEventAction, type AdminFormState } from '@/app/(admin)/admin/actions';
import { SubmitButton } from '@/components/admin/ui';
import { keepValuesOnError } from '@/components/keep-values-on-error';
import {
  ARRIVE_BY_OPTIONS,
  DEFAULT_ARRIVE_BY,
  DEFAULT_LEAVE_FROM,
  KEEP_TIMES,
  LEAVE_FROM_OPTIONS,
  type ArriveBy,
  type LeaveFrom,
} from '@/lib/events/attendance-rules';
import { formatDateTimeLocalInput } from '@/lib/format';

const initial: AdminFormState = {};

export interface EventValues {
  id: string;
  name: string;
  summary: string;
  location: string;
  startsAt: string;
  endsAt: string;
  isPublic: boolean;
  points: number;
  arriveBy: ArriveBy | typeof KEEP_TIMES;
  leaveFrom: LeaveFrom | typeof KEEP_TIMES;
  bonus: { name: string; startsAt: string; endsAt: string; points: number } | null;
}

function local(value: string | undefined): string {
  if (!value) return '';
  try {
    return formatDateTimeLocalInput(value);
  } catch {
    return '';
  }
}

const sectionClass = 'border border-border bg-subtle/50 px-4 py-3';
const summaryClass = 'cursor-pointer text-sm font-bold';

export function EventForm({ event }: { event?: EventValues }) {
  const [state, action] = useActionState(saveEventAction, initial);
  const arriveBy = event?.arriveBy ?? DEFAULT_ARRIVE_BY;
  const leaveFrom = event?.leaveFrom ?? DEFAULT_LEAVE_FROM;
  const customTimes = arriveBy === KEEP_TIMES || leaveFrom === KEEP_TIMES;

  return (
    <form action={action} onReset={keepValuesOnError(state)} className="space-y-5" noValidate>
      {event ? <input type="hidden" name="eventId" value={event.id} /> : null}

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
        <Field label="Starts" htmlFor="event-starts" required>
          <Input
            id="event-starts"
            name="startsAt"
            type="datetime-local"
            defaultValue={local(event?.startsAt)}
            required
          />
        </Field>
        <Field label="Ends" htmlFor="event-ends" required>
          <Input
            id="event-ends"
            name="endsAt"
            type="datetime-local"
            defaultValue={local(event?.endsAt)}
            required
          />
        </Field>
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
        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="event-summary">
            <Textarea
              id="event-summary"
              name="summary"
              defaultValue={event?.summary}
              maxLength={400}
              rows={3}
            />
          </Field>
        </div>
        <Field label="Points for attending" htmlFor="event-points" required>
          <Input
            id="event-points"
            name="points"
            type="number"
            defaultValue={event?.points ?? 10}
            required
            min={0}
            max={10000}
          />
        </Field>
        <div className="flex items-end pb-2.5">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
            <input
              type="checkbox"
              name="isPublic"
              defaultChecked={event?.isPublic ?? true}
              className="size-4 rounded border-input accent-primary"
            />
            Show on the public events page
          </label>
        </div>
      </div>

      <details className={sectionClass} open={customTimes}>
        <summary className={summaryClass}>Attendance rules</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="Late arrivals can check in until" htmlFor="event-arrive-by">
            <Select id="event-arrive-by" name="arriveBy" defaultValue={arriveBy}>
              {arriveBy === KEEP_TIMES ? (
                <option value={KEEP_TIMES}>Custom time (unchanged)</option>
              ) : null}
              {ARRIVE_BY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Check-out opens" htmlFor="event-leave-from">
            <Select id="event-leave-from" name="leaveFrom" defaultValue={leaveFrom}>
              {leaveFrom === KEEP_TIMES ? (
                <option value={KEEP_TIMES}>Custom time (unchanged)</option>
              ) : null}
              {LEAVE_FROM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Members earn the points by checking in and then checking out inside these times. Check-in
          opens 30 minutes before the start, and check-out stays open for an hour after the end.
        </p>
      </details>

      <details className={sectionClass} open={Boolean(event?.bonus)}>
        <summary className={summaryClass}>Bonus session (optional)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="Bonus session name"
              htmlFor="bonus-name"
              hint="Leave this empty for no bonus session."
            >
              <Input
                id="bonus-name"
                name="bonusName"
                defaultValue={event?.bonus?.name}
                maxLength={80}
              />
            </Field>
          </div>
          <Field label="Starts" htmlFor="bonus-starts">
            <Input
              id="bonus-starts"
              name="bonusStartsAt"
              type="datetime-local"
              defaultValue={local(event?.bonus?.startsAt)}
            />
          </Field>
          <Field label="Ends" htmlFor="bonus-ends">
            <Input
              id="bonus-ends"
              name="bonusEndsAt"
              type="datetime-local"
              defaultValue={local(event?.bonus?.endsAt)}
            />
          </Field>
          <Field label="Extra points" htmlFor="bonus-points">
            <Input
              id="bonus-points"
              name="bonusPoints"
              type="number"
              defaultValue={event?.bonus?.points ?? 5}
              min={0}
              max={10000}
            />
          </Field>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          A separate part of the event, such as a workshop, with its own check-in and its own
          points. The attendance rules above apply to it too.
        </p>
      </details>

      <p className="text-xs leading-relaxed text-muted-foreground">All times are US Eastern.</p>
      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
      <SubmitButton pendingLabel="Saving event…">
        {event ? 'Save changes' : 'Create event'}
      </SubmitButton>
    </form>
  );
}
