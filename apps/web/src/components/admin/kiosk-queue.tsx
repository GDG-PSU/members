'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ScanLine, WifiOff, X } from 'lucide-react';
import { Alert, Badge, Button, Card, CardContent, MemberAvatar } from '@gdg/ui';

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
    <div className="space-y-3">
      {offline ? (
        <Alert
          variant="warning"
          role="status"
          icon={<WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />}
        >
          Kiosk connection lost. Confirmations are disabled until the server responds. Nothing is
          awarded offline.
        </Alert>
      ) : null}
      {message ? (
        <Alert variant={message.kind === 'success' ? 'success' : 'danger'}>{message.text}</Alert>
      ) : null}

      {scans.length === 0 ? (
        <Card className="border-dashed bg-subtle">
          <CardContent className="flex flex-col items-center px-6 py-14 text-center">
            <span className="relative mb-4 grid size-14 place-items-center rounded-full border border-border bg-card text-primary">
              <span
                aria-hidden
                className="absolute inset-0 animate-ping rounded-full border border-primary/25"
              />
              <ScanLine className="size-6" aria-hidden />
            </span>
            <h2 className="type-h3">Waiting for a tap</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Card taps appear here for human confirmation. Keep this tab open at the door.
            </p>
          </CardContent>
        </Card>
      ) : (
        scans.map((scan) => {
          const expired = false;
          const nextAction = scan.suggestedAction === 'check_out' ? 'check_out' : 'check_in';
          return (
            <Card key={scan.id} className="overflow-hidden border-l-4 border-l-primary">
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <MemberAvatar name={scan.memberName} photoUrl={scan.photoUrl} size={76} />

                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-extrabold leading-tight tracking-[-0.02em] sm:text-2xl">
                      {scan.memberName}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {scan.memberNumber} · {scan.lane}
                    </p>
                    <p className="mt-1.5 text-sm font-medium">
                      {scan.eventName} · {scan.sessionName}
                    </p>
                    {expired ? (
                      <Badge variant="danger" className="mt-2">
                        Expired — ask for a fresh tap
                      </Badge>
                    ) : null}
                  </div>

                  <div className="flex w-full gap-2 sm:w-52 sm:flex-col">
                    <Button
                      size="lg"
                      disabled={busyId === scan.id || expired}
                      onClick={() => confirm(scan, nextAction)}
                      className="flex-1 sm:w-full"
                    >
                      <CheckCircle2 className="size-4" aria-hidden />
                      {busyId === scan.id
                        ? 'Confirming…'
                        : `Confirm ${nextAction === 'check_out' ? 'check-out' : 'check-in'}`}
                    </Button>
                    <Button
                      variant="ghost"
                      size="lg"
                      disabled={busyId === scan.id}
                      onClick={() => confirm(scan, 'reject')}
                      className="shrink-0 text-muted-foreground sm:w-full"
                    >
                      <X className="size-4" aria-hidden />
                      Reject
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      <p className="pt-1 text-[0.72rem] leading-relaxed text-muted-foreground">
        Point and star awards happen only on confirmed check-out when the session threshold is met.
      </p>
    </div>
  );
}
