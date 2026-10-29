import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
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
    <Box>
      <Typography variant="h6" sx={{ mb: 1.5 }}>
        {label}
      </Typography>
      <input type="hidden" name={`${prefix}Id`} value={value.id} />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            name={`${prefix}Name`}
            label="Session name"
            defaultValue={value.name}
            required={!optional}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <TextField
            name={`${prefix}MinDuration`}
            label="Min. minutes"
            type="number"
            defaultValue={value.minimumDurationMinutes}
            required={!optional}
            fullWidth
            slotProps={{ htmlInput: { min: 0, max: 1440 } }}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <TextField
            name={`${prefix}Reward`}
            label="Points"
            type="number"
            defaultValue={value.rewardPoints}
            required={!optional}
            fullWidth
            slotProps={{ htmlInput: { min: 0, max: 10000 } }}
          />
        </Grid>
        {(
          [
            ['StartsAt', 'Starts', value.startsAt],
            ['EndsAt', 'Ends', value.endsAt],
            ['CheckInOpensAt', 'Check-in opens', value.checkInOpensAt],
            ['CheckInClosesAt', 'Check-in closes', value.checkInClosesAt],
            ['CheckOutOpensAt', 'Check-out opens', value.checkOutOpensAt],
            ['CheckOutClosesAt', 'Check-out closes', value.checkOutClosesAt],
          ] as const
        ).map(([key, fieldLabel, fieldValue]) => (
          <Grid key={key} size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              name={`${prefix}${key}`}
              label={`${fieldLabel} (ET)`}
              type="datetime-local"
              defaultValue={local(fieldValue)}
              required={!optional || Boolean(value.name)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}

export function EventForm({ event, returnTo }: { event?: EventValues; returnTo: string }) {
  const main = event?.sessions.find((session) => session.kind === 'main');
  const bonus = event?.sessions.find((session) => session.kind === 'bonus');
  return (
    <Stack component="form" action={saveEventAction} spacing={3} noValidate>
      <input type="hidden" name="returnTo" value={returnTo} />
      {event?.id ? <input type="hidden" name="eventId" value={event.id} /> : null}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 8 }}>
          <TextField
            name="name"
            label="Event name"
            defaultValue={event?.name}
            required
            fullWidth
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            name="slug"
            label="Slug"
            defaultValue={event?.slug}
            required
            fullWidth
            helperText="lowercase-words-with-dashes"
          />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <TextField
            name="summary"
            label="Summary"
            defaultValue={event?.summary}
            fullWidth
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: 400 } }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 5 }}>
          <TextField
            name="location"
            label="Location"
            defaultValue={event?.location}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 160 } }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 3 }}>
          <TextField
            select
            name="status"
            label="Status"
            defaultValue={event?.status ?? 'draft'}
            fullWidth
          >
            <MenuItem value="draft">Draft</MenuItem>
            <MenuItem value="published">Published</MenuItem>
            <MenuItem value="cancelled">Cancelled</MenuItem>
            <MenuItem value="completed">Completed</MenuItem>
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControlLabel
            control={<Checkbox name="isPublic" defaultChecked={event?.isPublic ?? true} />}
            label="Public listing"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            name="startsAt"
            label="Event starts (ET)"
            type="datetime-local"
            defaultValue={local(event?.startsAt)}
            required
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            name="endsAt"
            label="Event ends (ET)"
            type="datetime-local"
            defaultValue={local(event?.endsAt)}
            required
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Grid>
      </Grid>

      <SessionFields prefix="main" label="Main session" session={main} />
      <SessionFields prefix="bonus" label="Bonus session (optional)" session={bonus} optional />

      <Typography variant="caption" color="text.secondary">
        Times are interpreted as America/New_York wall-clock. Rewards are snapshotted onto each
        attendance record when checkout is confirmed, so later edits never rewrite history.
      </Typography>
      <SubmitButton pendingLabel="Saving event…">
        {event?.id ? 'Save changes' : 'Create event'}
      </SubmitButton>
    </Stack>
  );
}
