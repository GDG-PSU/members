'use client';

import { useActionState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Button } from '@mui/material';
import { enrollMfaAction, verifyMfaAction, type MfaState } from '@/app/admin-mfa/actions';
import { SubmitButton } from '@/components/admin/ui';

const initial: MfaState = {};

export function MfaPanel({
  hasVerifiedFactor,
  email,
  verifiedFactorId,
}: {
  hasVerifiedFactor: boolean;
  email: string;
  verifiedFactorId?: string;
}) {
  const [enrollState, enrollAction, enrolling] = useActionState(enrollMfaAction, initial);
  const [verifyState, verifyAction] = useActionState(verifyMfaAction, initial);
  const factorId = enrollState.factorId ?? verifyState.factorId ?? verifiedFactorId ?? '';

  if (hasVerifiedFactor) {
    return (
      <Box component="form" action={verifyAction}>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Signed in as {email}. Enter the current code from your authenticator app.
          </Typography>
          <input type="hidden" name="factorId" value={factorId} />
          <TextField
            name="code"
            label="Six-digit code"
            slotProps={{
              htmlInput: {
                inputMode: 'numeric',
                pattern: '[0-9]{6}',
                maxLength: 6,
                autoComplete: 'one-time-code',
              },
            }}
            required
            autoFocus
          />
          {verifyState.error ? <Alert severity="error">{verifyState.error}</Alert> : null}
          <SubmitButton pendingLabel="Verifying…">Verify and open admin</SubmitButton>
        </Stack>
      </Box>
    );
  }

  if (enrollState.qrCode) {
    return (
      <Box component="form" action={verifyAction}>
        <Stack spacing={2.5}>
          <Alert severity="info">
            Scan the QR code with your authenticator app, then enter the six-digit code below.
          </Alert>
          <Box
            component="img"
            src={enrollState.qrCode}
            alt="TOTP enrollment QR code"
            sx={{
              width: 220,
              height: 220,
              alignSelf: 'center',
              bgcolor: '#fff',
              p: 1,
              borderRadius: 2,
            }}
          />
          {enrollState.secret ? (
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              Manual key: <Box component="code">{enrollState.secret}</Box>
            </Typography>
          ) : null}
          <input type="hidden" name="factorId" value={enrollState.factorId ?? ''} />
          <TextField
            name="code"
            label="Six-digit code"
            slotProps={{
              htmlInput: {
                inputMode: 'numeric',
                pattern: '[0-9]{6}',
                maxLength: 6,
                autoComplete: 'one-time-code',
              },
            }}
            required
            autoFocus
          />
          {verifyState.error ? <Alert severity="error">{verifyState.error}</Alert> : null}
          <SubmitButton pendingLabel="Verifying…">Verify and open admin</SubmitButton>
        </Stack>
      </Box>
    );
  }

  return (
    <Box component="form" action={enrollAction}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          No authenticator is enrolled for {email}. Enroll one now — you will need it for every
          admin session.
        </Typography>
        {enrollState.error ? <Alert severity="error">{enrollState.error}</Alert> : null}
        <Button type="submit" variant="contained" disabled={enrolling}>
          {enrolling ? 'Starting…' : 'Set up authenticator'}
        </Button>
      </Stack>
    </Box>
  );
}
