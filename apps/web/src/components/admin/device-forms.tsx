'use client';

import { useActionState } from 'react';
import { Copy } from 'lucide-react';
import { Alert, Button, Field, Input, Select } from '@gdg/ui';
import {
  createDeviceAction,
  updateDeviceAction,
  type DeviceFormState,
} from '@/app/(admin)/admin/actions';

const initial: DeviceFormState = {};

export interface EventOption {
  id: string;
  name: string;
  sessions: { id: string; name: string; kind: string }[];
}

export function DeviceCreateForm({ events }: { events: EventOption[] }) {
  const [state, action, pending] = useActionState(createDeviceAction, initial);

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field
        label="Device ID"
        htmlFor="device-id"
        required
        hint="Lowercase letters, digits, dashes · e.g. lane-a"
      >
        <Input
          id="device-id"
          name="deviceId"
          required
          pattern="[a-z0-9][a-z0-9-]{2,31}"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <Field label="Lane label" htmlFor="lane-label" required>
        <Input id="lane-label" name="laneLabel" required maxLength={40} autoComplete="off" />
      </Field>

      <Field label="Initial mode" htmlFor="device-mode">
        <Select id="device-mode" name="mode" defaultValue="kiosk">
          <option value="kiosk">Kiosk (attendance)</option>
          <option value="writer">Writer (card writing)</option>
        </Select>
      </Field>

      <Field label="Assigned event (optional)" htmlFor="device-event">
        <Select id="device-event" name="eventId" defaultValue="">
          <option value="">None</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Assigned session (optional)" htmlFor="device-session">
        <Select id="device-session" name="sessionId" defaultValue="">
          <option value="">None</option>
          {events.flatMap((event) =>
            event.sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {event.name} — {session.name}
              </option>
            )),
          )}
        </Select>
      </Field>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Registering…' : 'Register device'}
      </Button>

      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}

      {state.secret ? (
        <Alert variant="warning" title="Copy this secret now — it is shown once.">
          <div className="mt-2 flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-card px-2.5 py-2 font-mono text-[0.72rem] leading-relaxed">
              {state.secret}
            </code>
            <Button
              variant="secondary"
              size="icon"
              aria-label="Copy device secret"
              onClick={() => {
                if (state.secret) void navigator.clipboard?.writeText(state.secret);
              }}
            >
              <Copy className="size-4" aria-hidden />
            </Button>
          </div>
          <p className="mt-2 text-[0.78rem] leading-relaxed">
            Paste it into the firmware secrets file; it cannot be recovered.
          </p>
        </Alert>
      ) : null}
    </form>
  );
}

const checkboxClass =
  'size-4 shrink-0 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function DeviceEditForm({
  device,
  events,
}: {
  device: {
    id: string;
    deviceId: string;
    laneLabel: string;
    mode: string;
    status: string;
    eventId: string | null;
    sessionId: string | null;
  };
  events: EventOption[];
}) {
  const [state, action, pending] = useActionState(updateDeviceAction, initial);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="deviceUuid" value={device.id} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Lane label" htmlFor={`lane-${device.id}`}>
          <Input
            id={`lane-${device.id}`}
            name="laneLabel"
            defaultValue={device.laneLabel}
            maxLength={40}
            autoComplete="off"
          />
        </Field>

        <Field label="Mode" htmlFor={`mode-${device.id}`}>
          <Select id={`mode-${device.id}`} name="mode" defaultValue={device.mode}>
            <option value="kiosk">Kiosk</option>
            <option value="writer">Writer</option>
          </Select>
        </Field>

        <Field label="Event" htmlFor={`event-${device.id}`}>
          <Select id={`event-${device.id}`} name="eventId" defaultValue={device.eventId ?? ''}>
            <option value="">None</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Session" htmlFor={`session-${device.id}`}>
          <Select
            id={`session-${device.id}`}
            name="sessionId"
            defaultValue={device.sessionId ?? ''}
          >
            <option value="">None</option>
            {events.flatMap((event) =>
              event.sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {event.name} — {session.name}
                </option>
              )),
            )}
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-5 pt-1">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={device.status === 'active'}
            className={checkboxClass}
          />
          Enabled
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="rotateSecret" className={checkboxClass} />
          Rotate secret
        </label>
      </div>

      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? 'Updating…' : 'Update device'}
        </Button>
      </div>

      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}

      {state.secret ? (
        <Alert variant="warning" title="New secret (shown once)">
          <code className="mt-1 block break-all font-mono text-[0.72rem] leading-relaxed">
            {state.secret}
          </code>
        </Alert>
      ) : null}
    </form>
  );
}
