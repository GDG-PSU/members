'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { QrCode, Search } from 'lucide-react';
import { Alert, Button, Card, CardContent, Field, Input, MemberAvatar, Select } from '@gdg/ui';
import {
  previewKioskLookupAction,
  previewUsbKioskAction,
  searchKioskMembersAction,
  type KioskMemberHit,
  type UsbKioskPreview,
} from '@/app/(admin)/admin/actions';
import { formatDateTime } from '@/lib/format';
import { QrScanDialog } from '@/components/admin/qr-scan-dialog';
import { ReaderConnection, ReaderDetails, ReaderError } from '@/components/admin/reader-controls';
import { useReader } from '@/components/admin/use-reader';
import {
  isAbortError,
  isDisconnected,
  isReaderFault,
  laneErrorMessage,
  waitForCard,
  waitForCardRemoved,
} from '@/components/admin/wait-for-card';

export type KioskSessionOption = {
  id: string;
  label: string;
};

type Message = { kind: 'success' | 'danger'; text: string };
type ReaderStep = 'waiting' | 'lift';

const METHOD_LABELS = { card: 'Card', qr: 'QR code', manual: 'Found by organizer' } as const;
const READER_FAULT_RETRY_MS = 1500;
const SEARCH_DELAY_MS = 250;

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

export function UsbKioskPanel({
  sessions,
  initialSessionId,
}: {
  sessions: KioskSessionOption[];
  initialSessionId?: string;
}) {
  const [sessionId, setSessionId] = useState(
    sessions.some((session) => session.id === initialSessionId)
      ? (initialSessionId ?? '')
      : (sessions[0]?.id ?? ''),
  );
  const [scan, setScan] = useState<UsbKioskPreview | null>(null);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [busy, setBusy] = useState<'confirm' | 'reject' | 'lookup' | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [readerStep, setReaderStep] = useState<ReaderStep>('waiting');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<KioskMemberHit[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const reader = useReader();
  const { connected, sendCommand } = reader;
  // A card that has been read stays on the reader until someone lifts it. Reading
  // it again would offer the same person a second action they did not ask for.
  const cardOnReaderRef = useRef(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // The reader is always reading while it is connected and nobody is on screen.
  useEffect(() => {
    if (!connected || !sessionId || scan) return;
    const controller = new AbortController();
    const { signal } = controller;
    const read = () => sendCommand('nfc.read');

    void (async () => {
      while (!signal.aborted) {
        try {
          if (cardOnReaderRef.current) {
            setReaderStep('lift');
            await waitForCardRemoved(read, signal);
            cardOnReaderRef.current = false;
          }
          setReaderStep('waiting');

          const response = await waitForCard(read, signal);
          cardOnReaderRef.current = true;
          setReaderStep('lift');
          const uri = response.result?.uri;
          if (!uri) throw new Error('ndef_record_missing');

          const preview = await previewUsbKioskAction({ uri, sessionId });
          if (signal.aborted) return;
          if (!preview.ok || !preview.scanId) {
            setMessage({ kind: 'danger', text: preview.error ?? 'Could not resolve this card.' });
            continue;
          }
          setMessage(null);
          setIdentityChecked(false);
          setScan(preview);
          return;
        } catch (readError) {
          // A lost reader is reported by the reader's own status, not as a bad card.
          if (signal.aborted || isAbortError(readError) || isDisconnected(readError)) return;
          setMessage({ kind: 'danger', text: laneErrorMessage(readError) });
          if (isReaderFault(readError)) {
            await pause(READER_FAULT_RETRY_MS, signal);
          } else {
            // An unreadable card is still a card on the reader.
            cardOnReaderRef.current = true;
            setReaderStep('lift');
          }
        }
      }
    })();

    return () => controller.abort();
  }, [connected, sessionId, scan, sendCommand]);

  // Enter or Space confirms the person on screen, once any ID check is ticked.
  useEffect(() => {
    if (scan && !(scan.photoChangedRecently && !identityChecked)) confirmRef.current?.focus();
  }, [scan, identityChecked]);

  // A scanner types a whole profile link; that is looked up on Enter instead.
  const searchText = query.trim();
  const searchable = searchText.length >= 2 && !/^https?:/i.test(searchText);
  useEffect(() => {
    if (!searchable) return;
    const text = searchText;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchKioskMembersAction(text).then((found) => {
        if (!cancelled) setHits(found);
      });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchable, searchText]);

  function clearPerson() {
    setScan(null);
    setIdentityChecked(false);
  }

  async function lookUp(input: { memberId?: string; code?: string }) {
    if (!sessionId) {
      setMessage({ kind: 'danger', text: 'Choose an event session first.' });
      return;
    }
    setBusy('lookup');
    setMessage(null);
    try {
      const preview = await previewKioskLookupAction({ sessionId, ...input });
      if (!preview.ok || !preview.scanId) {
        setMessage({ kind: 'danger', text: preview.error ?? 'Could not find that member.' });
        return;
      }
      setIdentityChecked(false);
      setScan(preview);
      setQuery('');
      setHits(null);
    } catch (lookupError) {
      setMessage({ kind: 'danger', text: laneErrorMessage(lookupError) });
    } finally {
      setBusy(null);
    }
  }

  async function decide(action: 'check_in' | 'check_out' | 'reject') {
    if (!scan?.scanId) return;
    if (action !== 'reject' && scan.photoChangedRecently && !identityChecked) {
      setMessage({ kind: 'danger', text: 'Check the member’s PSU ID before confirming.' });
      return;
    }

    setBusy(action === 'reject' ? 'reject' : 'confirm');
    setMessage(null);
    try {
      const response = await fetch('/api/admin/kiosk/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scanId: scan.scanId,
          action,
          identityCheck: scan.photoChangedRecently ? identityChecked : undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? 'Confirmation failed.');
      }

      setMessage({
        kind: 'success',
        text:
          action === 'reject'
            ? 'Scan dismissed. Nothing was recorded.'
            : action === 'check_out'
              ? `${scan.memberName} checked out.`
              : `${scan.memberName} checked in.`,
      });
      clearPerson();
    } catch (confirmError) {
      setMessage({ kind: 'danger', text: laneErrorMessage(confirmError) });
    } finally {
      setBusy(null);
    }
  }

  const action = scan?.action ?? 'check_in';
  const actionLabel = action === 'check_out' ? 'check-out' : 'check-in';
  const needsIdCheck = Boolean(scan?.photoChangedRecently && !identityChecked);
  const readerLine = readerStep === 'lift' ? 'Lift the card off the reader' : 'Waiting for a card';

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="Event session" htmlFor="kiosk-session" required>
            <Select
              id="kiosk-session"
              value={sessionId}
              onChange={(event) => {
                setSessionId(event.target.value);
                clearPerson();
              }}
              disabled={busy !== null || sessions.length === 0}
            >
              {sessions.length === 0 ? (
                <option value="">No current sessions</option>
              ) : (
                sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.label}
                  </option>
                ))
              )}
            </Select>
          </Field>
          <ReaderConnection reader={reader} line={readerLine} />
        </CardContent>
      </Card>

      {sessions.length === 0 ? (
        <Alert variant="warning">
          No event sessions are available. Create or publish an event in{' '}
          <Link href="/admin/events" className="font-semibold underline underline-offset-2">
            Events
          </Link>{' '}
          before opening the kiosk.
        </Alert>
      ) : null}
      <ReaderError reader={reader} />
      {message ? (
        <Alert variant={message.kind === 'success' ? 'success' : 'danger'} role="status">
          {message.text}
        </Alert>
      ) : null}

      {scan ? (
        <Card className="overflow-hidden border-l-4 border-l-primary">
          <CardContent className="space-y-5 p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <MemberAvatar
                name={scan.memberName ?? 'Member'}
                photoUrl={scan.photoUrl ?? null}
                size={104}
              />
              <div className="min-w-0 flex-1">
                <h2 className="text-2xl font-extrabold leading-tight tracking-[-0.02em] sm:text-3xl">
                  {scan.memberName}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {scan.memberNumber} · {scan.eventName} · {scan.sessionName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Identified by: {METHOD_LABELS[scan.method ?? 'card']}
                </p>
              </div>
            </div>

            {scan.photoChangedRecently ? (
              <Alert variant="warning" title="Photo changed in the last 48 hours">
                <p>
                  Last changed {formatDateTime(scan.photoChangedAt)}. Check their PSU ID before
                  confirming.
                </p>
                <label className="mt-2.5 flex items-start gap-2.5 text-sm font-semibold text-foreground">
                  <input
                    type="checkbox"
                    checked={identityChecked}
                    onChange={(event) => setIdentityChecked(event.target.checked)}
                    className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
                  />
                  I checked this member&apos;s PSU ID
                </label>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Button
                ref={confirmRef}
                disabled={busy !== null || needsIdCheck}
                onClick={() => void decide(action)}
                className="h-16 w-full text-lg font-semibold"
              >
                {busy === 'confirm'
                  ? 'Confirming…'
                  : needsIdCheck
                    ? 'PSU ID required'
                    : `Confirm ${actionLabel}`}
              </Button>
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void decide('reject')}
                className="w-full text-muted-foreground"
              >
                {busy === 'reject' ? 'Dismissing…' : 'Dismiss scan'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed bg-subtle">
          <CardContent className="flex flex-col items-center px-6 py-14 text-center">
            <h2 className="type-h3">
              {!connected
                ? 'Connect the reader to start'
                : readerStep === 'lift'
                  ? 'Lift the card off the reader'
                  : 'Tap a card on the reader'}
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {connected
                ? 'The reader is always on. Each person appears here for you to confirm.'
                : 'No reader? You can still find members below.'}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-5">
          <h2 className="text-base font-bold">No card?</h2>
          <form
            className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              const text = query.trim();
              // A handheld scanner types the code and presses Enter.
              if (/^https?:/i.test(text) || /^gdg-[a-z0-9]{6}$/i.test(text)) {
                void lookUp({ code: text });
              } else if (searchable && hits?.length === 1 && hits[0]) {
                void lookUp({ memberId: hits[0].memberId });
              }
            }}
          >
            <Field label="Find a member" htmlFor="kiosk-search">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="kiosk-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  autoComplete="off"
                  placeholder="Name or GDG number"
                  className="pl-9"
                  disabled={busy !== null || Boolean(scan)}
                />
              </div>
            </Field>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setScanning(true)}
              disabled={busy !== null || Boolean(scan) || !sessionId}
            >
              <QrCode className="size-4" aria-hidden />
              Scan QR code
            </Button>
          </form>

          {searchable && hits ? (
            hits.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No active member matches.</p>
            ) : (
              <ul
                className="mt-3 divide-y divide-border border border-border"
                aria-label="Members found"
              >
                {hits.map((hit) => (
                  <li key={hit.memberId}>
                    <button
                      type="button"
                      onClick={() => void lookUp({ memberId: hit.memberId })}
                      disabled={busy !== null}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    >
                      <MemberAvatar name={hit.name} photoUrl={hit.photoUrl} size={40} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{hit.name}</span>
                        <span className="block text-xs text-muted-foreground">{hit.number}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </CardContent>
      </Card>

      <details className="border border-border bg-subtle/50 px-5 py-3 text-sm">
        <summary className="cursor-pointer font-medium">Reader troubleshooting</summary>
        <ReaderDetails reader={reader} />
      </details>

      <QrScanDialog
        open={scanning}
        onClose={() => setScanning(false)}
        onResult={(text) => {
          setScanning(false);
          void lookUp({ code: text });
        }}
      />
    </div>
  );
}
