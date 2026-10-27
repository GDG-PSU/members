'use client';

import { useActionState, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Visibility } from '@gdg/contracts';
import { VisibilityControl } from '@gdg/ui';
import { updatePrivacyAction, type ActionState } from '@/app/(member)/member/actions';

const initial: ActionState = {};

const fields: { key: keyof Visibility; label: string; description: string }[] = [
  { key: 'showDisplayName', label: 'Display name', description: 'Required for the leaderboard.' },
  { key: 'showPhoto', label: 'Profile photo', description: 'Shown on your profile and kiosk.' },
  { key: 'showAbout', label: 'Short bio', description: 'Your 280-character introduction.' },
  { key: 'showLinks', label: 'Links', description: 'https:// links only.' },
  { key: 'showMemberNumber', label: 'Member number', description: 'Your GDG-XXXXXX number.' },
  { key: 'showMemberSince', label: 'Member since', description: 'Your recorded join date.' },
  { key: 'showPoints', label: 'Points', description: 'Spendable balance; required for the leaderboard.' },
  { key: 'showStars', label: 'Stars', description: 'Lifetime participation tally.' },
  { key: 'showEvents', label: 'Events attended', description: 'Count of qualified events.' },
  { key: 'showOnLeaderboard', label: 'Leaderboard', description: 'Appear in the public ranking.' },
  { key: 'showEmail', label: 'Email address', description: 'Off by default. Only visible if you opt in.' },
];

export function PrivacyForm({ initial: initialSettings }: { initial: Visibility }) {
  const [state, action, pending] = useActionState(updatePrivacyAction, initial);
  const [settings, setSettings] = useState<Visibility>(initialSettings);

  const set = (key: keyof Visibility, value: boolean) =>
    setSettings((current) => ({ ...current, [key]: value }));

  return (
    <Card>
      <CardContent sx={{ p: { xs: 2.5, md: 3.5 } }}>
        <Stack component="form" action={action} spacing={2.5}>
          <Box
            sx={{
              p: 2,
              borderRadius: 2,
              bgcolor: 'surfaceMuted.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
            }}
          >
            <Box>
              <Typography variant="h5">Public profile</Typography>
              <Typography variant="caption" color="text.secondary">
                {settings.publicProfile
                  ? 'Anyone with your link can see the fields you enabled below.'
                  : 'Your profile link shows a neutral private state.'}
              </Typography>
            </Box>
            <FormControlLabel
              sx={{ m: 0 }}
              control={
                <Switch
                  checked={settings.publicProfile}
                  onChange={(event) => set('publicProfile', event.target.checked)}
                  slotProps={{ input: { 'aria-label': 'Public profile' } }}
                  color="primary"
                />
              }
              label=""
            />
          </Box>

          {fields.map((field, index) => (
            <Box key={field.key}>
              {index === 8 ? <Divider sx={{ mb: 1 }} /> : null}
              <VisibilityControl
                label={field.label}
                description={field.description}
                checked={settings[field.key]}
                disabled={!settings.publicProfile && field.key !== 'showEmail'}
                onChange={(value) => set(field.key, value)}
              />
            </Box>
          ))}

          {Object.entries(settings).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value ? 'on' : 'off'} />
          ))}

          {!settings.publicProfile ? (
            <Alert severity="info">
              Your profile is private. Visible fields are saved but not shown until you switch it back on.
            </Alert>
          ) : null}
          {state.error ? <Alert severity="error">{state.error}</Alert> : null}
          {state.ok ? <Alert severity="success">{state.message}</Alert> : null}

          <Button type="submit" variant="contained" disabled={pending} sx={{ alignSelf: 'flex-start' }}>
            {pending ? 'Saving…' : 'Save privacy settings'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
