'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

/**
 * Displays a one-time Supabase action link. No email is sent by the app; the
 * admin copies the link into their own mail client.
 */
export function LinkPanel({
  link,
  email,
  title,
}: {
  link: string;
  email?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <Stack spacing={1.5} sx={{ mt: 2 }}>
      <Alert severity="success" role="status">
        {title ?? 'Link ready'}
        {email ? ` for ${email}` : ''}. Send it privately; anyone with it can set the password.
      </Alert>
      <TextField
        value={link}
        fullWidth
        multiline
        minRows={2}
        size="small"
        slotProps={{ input: { readOnly: true } }}
        onFocus={(event) => event.currentTarget.select()}
        aria-label="One-time sign-in link"
      />
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Typography variant="caption" color="text.secondary">
          Links expire per your Supabase Auth OTP setting (default 1 hour). Generate a new one if it
          expires.
        </Typography>
      </Stack>
      {copyError ? (
        <Typography variant="caption" color="error">
          Copy failed — select the link and copy it manually.
        </Typography>
      ) : null}
    </Stack>
  );
}

export function LinkDialog({
  open,
  onClose,
  link,
  email,
  title = 'One-time link',
}: {
  open: boolean;
  onClose: () => void;
  link?: string;
  email?: string;
  title?: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {link ? <LinkPanel link={link} email={email} title="Copy this link" /> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
