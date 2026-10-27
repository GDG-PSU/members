'use client';

import { useActionState, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { completeSetupAction, type SetupState } from '@/app/(auth)/invite/accept/actions';

const initial: SetupState = {};

export function SetupForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(completeSetupAction, initial);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <Stack component="form" action={action} spacing={2.5} noValidate encType="multipart/form-data">
      <Alert severity="info">
        Status: {email} is invited. Your name and photo are required; you can hide them later.
      </Alert>
      <TextField
        label="Display name"
        name="displayName"
        required
        fullWidth
        autoComplete="name"
        slotProps={{ htmlInput: { maxLength: 60 } }}
        helperText="Shown on your profile and at the check-in kiosk."
      />
      <TextField
        label="Short bio"
        name="about"
        fullWidth
        multiline
        minRows={2}
        slotProps={{ htmlInput: { maxLength: 280 } }}
        helperText="Optional — a sentence is plenty."
      />

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Profile photo
        </Typography>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Box
            sx={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              bgcolor: 'surfaceMuted.main',
              backgroundImage: preview ? `url(${preview})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              border: '1px solid',
              borderColor: 'divider',
              flexShrink: 0,
            }}
            aria-hidden
          />
          <Box>
            <Button component="label" variant="outlined" size="small">
              Choose photo
              <input
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                required
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    setPhotoName(null);
                    setPreview(null);
                    return;
                  }
                  setPhotoName(file.name);
                  setPreview(URL.createObjectURL(file));
                }}
              />
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {photoName ?? 'JPEG, PNG or WebP · max 2 MB · cropped to a square'}
            </Typography>
          </Box>
        </Stack>
      </Box>

      <TextField
        label="Password"
        name="password"
        type="password"
        required
        fullWidth
        autoComplete="new-password"
        helperText="At least 12 characters with a number."
      />
      <TextField
        label="Confirm password"
        name="confirmPassword"
        type="password"
        required
        fullWidth
        autoComplete="new-password"
      />

      <FormControlLabel
        control={<Checkbox name="acceptTerms" required />}
        label={
          <Typography variant="body2" color="text.secondary">
            I understand my profile is public by default (email stays private), and that my card is an
            identifier, not a password. See the{' '}
            <Link href="/privacy" target="_blank">
              privacy note
            </Link>
            .
          </Typography>
        }
      />

      {state.error ? <Alert severity="error">{state.error}</Alert> : null}
      <Button type="submit" size="large" variant="contained" disabled={pending}>
        {pending ? 'Creating your profile…' : 'Create my profile'}
      </Button>
    </Stack>
  );
}
