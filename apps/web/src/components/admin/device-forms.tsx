'use client';

import { useActionState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import IconButton from '@mui/material/IconButton';
import {
  createDeviceAction,
  updateDeviceAction,
  type DeviceFormState,
} from '@/app/(admin)/admin/actions';
import { SubmitButton } from '@/components/admin/ui';

const initial: DeviceFormState = {};

export interface EventOption {
  id: string;
  name: string;
  sessions: { id: string; name: string; kind: string }[];
}

export function DeviceCreateForm({ events }: { events: EventOption[] }) {
  const [state, action, pending] = useActionState(createDeviceAction, initial);

  return (
    <Stack component="form" action={action} spacing={2} noValidate>
      <TextField
        name="deviceId"
        label="Device ID"
        required
        fullWidth
        helperText="Lowercase letters, digits, dashes · e.g. lane-a"
        slotProps={{ htmlInput: { pattern: '[a-z0-9][a-z0-9-]{2,31}' } }}
      />
      <TextField
        name="laneLabel"
        label="Lane label"
        required
        fullWidth
        slotProps={{ htmlInput: { maxLength: 40 } }}
      />
      <TextField select name="mode" label="Initial mode" defaultValue="kiosk" fullWidth>
        <MenuItem value="kiosk">Kiosk (attendance)</MenuItem>
        <MenuItem value="writer">Writer (card writing)</MenuItem>
      </TextField>
      <TextField select name="eventId" label="Assigned event (optional)" defaultValue="" fullWidth>
        <MenuItem value="">None</MenuItem>
        {events.map((event) => (
          <MenuItem key={event.id} value={event.id}>
            {event.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        name="sessionId"
        label="Assigned session (optional)"
        defaultValue=""
        fullWidth
      >
        <MenuItem value="">None</MenuItem>
        {events.flatMap((event) =>
          event.sessions.map((session) => (
            <MenuItem key={session.id} value={session.id}>
              {event.name} — {session.name}
            </MenuItem>
          )),
        )}
      </TextField>
      <SubmitButton pendingLabel="Registering…">Register device</SubmitButton>
      {state.error ? <Alert severity="error">{state.error}</Alert> : null}
      {state.secret ? (
        <Alert severity="warning">
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Copy this secret now — it is shown once.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box component="code" sx={{ wordBreak: 'break-all', fontSize: 12 }}>
              {state.secret}
            </Box>
            <IconButton
              size="small"
              aria-label="Copy device secret"
              onClick={() => {
                if (state.secret) void navigator.clipboard?.writeText(state.secret);
              }}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Box>
          <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
            Put this in the ignored firmware secrets file for {state.deviceId}. It is not stored in
            plaintext and cannot be recovered.
          </Typography>
        </Alert>
      ) : null}
      {pending ? null : null}
    </Stack>
  );
}

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
  const [state, action] = useActionState(updateDeviceAction, initial);

  return (
    <Stack component="form" action={action} spacing={1.5}>
      <input type="hidden" name="deviceUuid" value={device.id} />
      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            name="laneLabel"
            label="Lane label"
            defaultValue={device.laneLabel}
            fullWidth
            size="small"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            select
            name="mode"
            label="Mode"
            defaultValue={device.mode}
            fullWidth
            size="small"
          >
            <MenuItem value="kiosk">Kiosk</MenuItem>
            <MenuItem value="writer">Writer</MenuItem>
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            select
            name="eventId"
            label="Event"
            defaultValue={device.eventId ?? ''}
            fullWidth
            size="small"
          >
            <MenuItem value="">None</MenuItem>
            {events.map((event) => (
              <MenuItem key={event.id} value={event.id}>
                {event.name}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            select
            name="sessionId"
            label="Session"
            defaultValue={device.sessionId ?? ''}
            fullWidth
            size="small"
          >
            <MenuItem value="">None</MenuItem>
            {events.flatMap((event) =>
              event.sessions.map((session) => (
                <MenuItem key={session.id} value={session.id}>
                  {event.name} — {session.name}
                </MenuItem>
              )),
            )}
          </TextField>
        </Grid>
      </Grid>
      <Stack direction="row" spacing={2}>
        <FormControlLabel
          control={<Checkbox name="enabled" defaultChecked={device.status === 'active'} />}
          label="Enabled"
        />
        <FormControlLabel control={<Checkbox name="rotateSecret" />} label="Rotate secret" />
      </Stack>
      <Box>
        <SubmitButton size="small" variant="outlined" pendingLabel="Updating…">
          Update device
        </SubmitButton>
      </Box>
      {state.error ? <Alert severity="error">{state.error}</Alert> : null}
      {state.secret ? (
        <Alert severity="warning">
          New secret (shown once):{' '}
          <Box component="code" sx={{ wordBreak: 'break-all' }}>
            {state.secret}
          </Box>
        </Alert>
      ) : null}
    </Stack>
  );
}
