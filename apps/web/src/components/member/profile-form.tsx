'use client';

import { useActionState, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { updateProfileAction, type ActionState } from '@/app/(member)/member/actions';

const initial: ActionState = {};

interface ProfileFormProps {
  initialName: string;
  initialAbout: string;
  initialLinks: { label: string; url: string }[];
  photoUrl: string | null;
}

export function ProfileForm({ initialName, initialAbout, initialLinks, photoUrl }: ProfileFormProps) {
  const [state, action, pending] = useActionState(updateProfileAction, initial);
  const [links, setLinks] = useState(initialLinks.length > 0 ? initialLinks : []);
  const [preview, setPreview] = useState<string | null>(photoUrl);

  const updateLink = (index: number, field: 'label' | 'url', value: string) => {
    setLinks((current) => current.map((link, i) => (i === index ? { ...link, [field]: value } : link)));
  };

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 7 }}>
        <Card>
          <CardContent sx={{ p: { xs: 2.5, md: 3.5 } }}>
            <Stack component="form" action={action} spacing={2.5} noValidate encType="multipart/form-data">
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <Box
                  sx={{
                    width: 80,
                    height: 80,
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
                  <Button component="label" size="small" variant="outlined">
                    Replace photo
                    <input
                      type="file"
                      name="photo"
                      accept="image/jpeg,image/png,image/webp"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        setPreview(file ? URL.createObjectURL(file) : photoUrl);
                      }}
                    />
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                    Square crop · max 2 MB
                  </Typography>
                </Box>
              </Stack>

              <TextField
                label="Display name"
                name="displayName"
                defaultValue={initialName}
                required
                fullWidth
                slotProps={{ htmlInput: { maxLength: 60 } }}
              />
              <TextField
                label="Short bio"
                name="about"
                defaultValue={initialAbout}
                fullWidth
                multiline
                minRows={3}
                slotProps={{ htmlInput: { maxLength: 280 } }}
                helperText="Up to 280 characters. Rendered as plain text."
              />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Links
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  https:// only. Up to six.
                </Typography>
                <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                  {links.map((link, index) => (
                    <Stack key={index} direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <TextField
                        label="Label"
                        value={link.label}
                        onChange={(event) => updateLink(index, 'label', event.target.value)}
                        slotProps={{ htmlInput: { maxLength: 40 } }}
                        sx={{ sm: { width: 160 } }}
                      />
                      <TextField
                        label="https://…"
                        value={link.url}
                        onChange={(event) => updateLink(index, 'url', event.target.value)}
                        sx={{ flex: 1 }}
                        type="url"
                      />
                      <IconButton
                        aria-label={`Remove link ${link.label || index + 1}`}
                        onClick={() => setLinks((current) => current.filter((_, i) => i !== index))}
                      >
                        <DeleteOutlineIcon />
                      </IconButton>
                    </Stack>
                  ))}
                  {links.length < 6 ? (
                    <Button
                      startIcon={<AddIcon />}
                      size="small"
                      onClick={() => setLinks((current) => [...current, { label: '', url: '' }])}
                      sx={{ alignSelf: 'flex-start' }}
                    >
                      Add link
                    </Button>
                  ) : null}
                </Stack>
                <input
                  type="hidden"
                  name="links"
                  value={JSON.stringify(links.filter((link) => link.label && link.url))}
                />
              </Box>

              {state.error ? <Alert severity="error">{state.error}</Alert> : null}
              {state.ok ? <Alert severity="success">{state.message}</Alert> : null}
              <Button type="submit" variant="contained" disabled={pending} sx={{ alignSelf: 'flex-start' }}>
                {pending ? 'Saving…' : 'Save profile'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Grid>
      <Grid size={{ xs: 12, md: 5 }}>
        <Card sx={{ position: { md: 'sticky' }, top: { md: 96 }, overflow: 'hidden' }}>
          <Box sx={{ height: 6, background: 'linear-gradient(90deg, #1450a3, #0f766e, #a16207)' }} />
          <CardContent sx={{ p: 3 }}>
            <Typography variant="overline" color="text.secondary">
              Preview
            </Typography>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mt: 1.5, mb: 2 }}>
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  backgroundImage: preview ? `url(${preview})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
                aria-hidden
              />
              <Box>
                <Typography variant="h5">{initialName}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Public profile card
                </Typography>
              </Box>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Saved changes appear on your public profile immediately. Hidden fields stay hidden even if
              you fill them in here.
            </Typography>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}
