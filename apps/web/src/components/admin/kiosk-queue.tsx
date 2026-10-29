'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import { MemberAvatar } from '@gdg/ui';

interface Scan {
  id: string;
  memberId: string;
  memberName: string;
  memberNumber: string;
  photoUrl: string | null;
  eventName: string;
  sessionName: string;
  suggestedAction: string;
  lane: string;
  createdAt: string;
  expiresAt: string;
}

export function KioskQueue({ initialScans }: { initialScans: Scan[] }) {
  const [scans, setScans] = useState<Scan[]>(initialScans);
  const [offline, setOffline] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/kiosk/pending', { cache: 'no-store' });
      if (!response.ok) throw new Error('not ok');
      const body = (await response.json()) as { scans: Scan[] };
      setScans(body.scans);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    timer.current = setInterval(refresh, 4000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [refresh]);

  const confirm = async (scan: Scan, action: 'check_in' | 'check_out' | 'reject') => {
    setBusyId(scan.id);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/kiosk/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scanId: scan.id, action }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? 'Confirmation failed');
      }
      setMessage({
        kind: 'success',
        text:
          action === 'check_in'
            ? `${scan.memberName} checked in.`
            : action === 'check_out'
              ? `${scan.memberName} checked out.`
              : 'Scan rejected.',
      });
      setScans((current) => current.filter((item) => item.id !== scan.id));
      void refresh();
    } catch (cause) {
      setMessage({
        kind: 'error',
        text: cause instanceof Error ? cause.message : 'Confirmation failed',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Stack spacing={2}>
      {offline ? (
        <Alert severity="warning" icon={<WifiOffIcon />} role="status">
          Kiosk connection lost. Confirmations are disabled until the server responds. Nothing is
          awarded offline.
        </Alert>
      ) : null}
      {message ? <Alert severity={message.kind}>{message.text}</Alert> : null}

      {scans.length === 0 ? (
        <Card>
          <CardContent sx={{ p: 6, textAlign: 'center' }}>
            <Typography variant="h4" sx={{ mb: 1 }}>
              Waiting for a tap
            </Typography>
            <Typography color="text.secondary">
              Card taps appear here for human confirmation. Keep this tab open at the door.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        scans.map((scan) => {
          const expired = false;
          return (
            <Card key={scan.id} sx={{ borderLeft: '6px solid', borderLeftColor: 'primary.main' }}>
              <CardContent sx={{ p: 3 }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={2.5}
                  sx={{ alignItems: { sm: 'center' } }}
                >
                  <MemberAvatar name={scan.memberName} photoUrl={scan.photoUrl} size={80} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="h3" sx={{ fontSize: { xs: '1.6rem', md: '2rem' } }}>
                      {scan.memberName}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {scan.memberNumber} · {scan.lane}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      {scan.eventName} · {scan.sessionName}
                    </Typography>
                    {expired ? (
                      <Chip
                        size="small"
                        color="error"
                        label="Expired — ask for a fresh tap"
                        sx={{ mt: 1 }}
                      />
                    ) : null}
                  </Box>
                  <Stack direction={{ xs: 'row', sm: 'column' }} spacing={1} sx={{ minWidth: 190 }}>
                    <Button
                      variant="contained"
                      size="large"
                      startIcon={<CheckCircleOutlinedIcon />}
                      disabled={busyId === scan.id || expired}
                      onClick={() =>
                        confirm(
                          scan,
                          scan.suggestedAction === 'check_out' ? 'check_out' : 'check_in',
                        )
                      }
                    >
                      Confirm {scan.suggestedAction === 'check_out' ? 'check-out' : 'check-in'}
                    </Button>
                    <Button
                      color="inherit"
                      disabled={busyId === scan.id}
                      onClick={() => confirm(scan, 'reject')}
                    >
                      Reject
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          );
        })
      )}
      <Typography variant="caption" color="text.secondary">
        Point and star awards happen only on confirmed check-out when the session threshold is met.
      </Typography>
    </Stack>
  );
}
