'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Alert, Button, Card, CardContent, Field, Input, MemberAvatar, cn } from '@gdg/ui';
import {
  activateUsbCardAction,
  prepareUsbCardAction,
  searchCardHoldersAction,
  type CardHolder,
} from '@/app/(admin)/admin/actions';
import { useUsbLane } from '@/components/admin/use-usb-lane';
import {
  isAbortError,
  laneErrorMessage,
  waitForCard,
  waitForCardRemoved,
} from '@/components/admin/wait-for-card';

type Step = 'idle' | 'preparing' | 'waiting' | 'checking' | 'activating';
type Message = { kind: 'success' | 'danger'; text: string };

const STEP_LABELS: Record<Step, string> = {
  idle: 'Write card',
  preparing: 'Getting the card ready…',
  waiting: 'Place a card on the reader…',
  checking: 'Checking the card…',
  activating: 'Switching it on…',
};
const SEARCH_DELAY_MS = 250;

/**
 * One action writes a card: it is prepared, written, read back and switched on
 * without the organizer copying anything between steps. The person's current
 * card keeps working until the new one has been written and checked.
 */
export function CardWriter({ initialHolder }: { initialHolder?: CardHolder | null }) {
  const router = useRouter();
  const { connected, connecting, info, status, error, log, connect, disconnect, sendCommand } =
    useUsbLane({ autoConnect: true });
  const [holder, setHolder] = useState<CardHolder | null>(initialHolder ?? null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CardHolder[] | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [message, setMessage] = useState<Message | null>(null);
  // A written card must leave the reader before the next one is written, or the
  // next person's link would overwrite the card that was just made.
  const [mustLift, setMustLift] = useState(false);
  const [readBack, setReadBack] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  // Kept for a retry, so a failed write does not leave a trail of unused cards.
  const preparedRef = useRef<{ memberId: string; cardId: string; cardUrl: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!connected || !mustLift || step !== 'idle') return;
    const controller = new AbortController();
    waitForCardRemoved(() => sendCommand('nfc.read'), controller.signal)
      .then(() => setMustLift(false))
      .catch(() => {});
    return () => controller.abort();
  }, [connected, mustLift, step, sendCommand]);

  const searchText = query.trim();
  const searchable = !holder && searchText.length >= 2;
  useEffect(() => {
    if (!searchable) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchCardHoldersAction(searchText).then((found) => {
        if (!cancelled) setHits(found);
      });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchable, searchText]);

  function choose(next: CardHolder | null) {
    setHolder(next);
    setQuery('');
    setHits(null);
    setMessage(null);
  }

  async function writeCard() {
    if (!holder || step !== 'idle') return;
    const controller = new AbortController();
    abortRef.current = controller;
    setMessage(null);
    setReadBack(null);

    try {
      let prepared = preparedRef.current?.memberId === holder.memberId ? preparedRef.current : null;
      if (!prepared) {
        setStep('preparing');
        const form = new FormData();
        form.set('memberId', holder.memberId);
        const result = await prepareUsbCardAction({}, form);
        if (!result.ok || !result.cardId || !result.cardUrl) {
          throw new Error(result.error ?? 'The card could not be prepared.');
        }
        prepared = { memberId: holder.memberId, cardId: result.cardId, cardUrl: result.cardUrl };
        preparedRef.current = prepared;
      }
      const { cardId, cardUrl } = prepared;

      setStep('waiting');
      await waitForCard(() => sendCommand('nfc.write', { uri: cardUrl }), controller.signal);

      // The reader checks its own write; reading it again here means the card is
      // switched on only when this browser has seen the right link on it.
      setStep('checking');
      const read = await sendCommand('nfc.read');
      if (read.result?.uri !== cardUrl) throw new Error('read_back_mismatch');

      setStep('activating');
      const form = new FormData();
      form.set('cardId', cardId);
      form.set('readBackVerified', 'on');
      const activated = await activateUsbCardAction({}, form);
      if (!activated.activated) {
        throw new Error(activated.error ?? 'The card could not be switched on.');
      }

      preparedRef.current = null;
      setMustLift(true);
      setHolder(null);
      setQuery('');
      setHits(null);
      setMessage({
        kind: 'success',
        text: `${holder.name}'s card is written and working. Lift it off the reader.`,
      });
      router.refresh();
    } catch (writeError) {
      if (!controller.signal.aborted && !isAbortError(writeError)) {
        setMessage({ kind: 'danger', text: laneErrorMessage(writeError) });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStep('idle');
    }
  }

  async function readCard() {
    if (reading || step !== 'idle') return;
    const controller = new AbortController();
    abortRef.current = controller;
    setReading(true);
    setReadBack(null);
    setMessage(null);
    try {
      const response = await waitForCard(() => sendCommand('nfc.read'), controller.signal);
      setReadBack(response.result?.uri ?? '');
    } catch (readError) {
      if (!controller.signal.aborted && !isAbortError(readError)) {
        setMessage({ kind: 'danger', text: laneErrorMessage(readError) });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setReading(false);
    }
  }

  const working = step !== 'idle';
  const readerLine = connecting
    ? status || 'Connecting to the reader…'
    : !connected
      ? 'Reader not connected'
      : mustLift
        ? 'Lift the card off the reader'
        : 'Reader connected';

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm" role="status">
              <span
                aria-hidden
                className={cn(
                  'size-2.5 rounded-full',
                  connected ? 'bg-success' : connecting ? 'bg-warning' : 'bg-muted-foreground',
                )}
              />
              {readerLine}
            </p>
            {connected ? (
              <Button variant="secondary" onClick={() => void disconnect()} disabled={working}>
                Disconnect
              </Button>
            ) : (
              <Button onClick={() => void connect()} disabled={connecting}>
                {connecting ? 'Connecting…' : 'Connect reader'}
              </Button>
            )}
          </div>

          {error ? (
            <Alert variant="danger" role="alert">
              {error}
            </Alert>
          ) : null}

          <div>
            <p className="text-sm font-bold">1. Who is this card for?</p>
            {holder ? (
              <div className="mt-3 flex items-center gap-3 border border-border bg-background p-3">
                <MemberAvatar name={holder.name} photoUrl={holder.photoUrl} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{holder.name}</p>
                  <p className="text-xs text-muted-foreground">{holder.detail}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => choose(null)} disabled={working}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="mt-3">
                <Field label="Find a person" htmlFor="card-holder-search">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      id="card-holder-search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      autoComplete="off"
                      placeholder="Name or GDG number"
                      className="pl-9"
                    />
                  </div>
                </Field>
                {searchable && hits ? (
                  hits.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">Nobody active matches.</p>
                  ) : (
                    <ul
                      className="mt-3 divide-y divide-border border border-border"
                      aria-label="People found"
                    >
                      {hits.map((hit) => (
                        <li key={hit.memberId}>
                          <button
                            type="button"
                            onClick={() => choose(hit)}
                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                          >
                            <MemberAvatar name={hit.name} photoUrl={hit.photoUrl} size={40} />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold">
                                {hit.name}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {hit.detail}
                                {hit.hasActiveCard ? ' · has a card' : ''}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </div>
            )}
            {holder?.hasActiveCard ? (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {holder.name} already has a card. It keeps working until the new one is written,
                then stops.
              </p>
            ) : null}
          </div>

          <div>
            <p className="text-sm font-bold">2. Write it</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                onClick={() => void writeCard()}
                disabled={!holder || !connected || working || mustLift}
                className="h-12 min-w-56"
              >
                {STEP_LABELS[step]}
              </Button>
              {step === 'waiting' ? (
                <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
                  Cancel
                </Button>
              ) : null}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {!connected
                ? 'Connect the reader first.'
                : mustLift
                  ? 'Lift the last card off the reader before writing the next one.'
                  : !holder
                    ? 'Choose who the card is for.'
                    : 'Place a card on the reader. It is written, checked and switched on in one go.'}
            </p>
          </div>

          {message ? (
            <Alert variant={message.kind === 'success' ? 'success' : 'danger'} role="status">
              {message.text}
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <details className="border border-border bg-subtle/50 px-5 py-3 text-sm">
        <summary className="cursor-pointer font-medium">Reader tools</summary>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void readCard()}
            disabled={!connected || working || reading}
          >
            {reading ? 'Waiting for a card…' : 'Read a card'}
          </Button>
          {reading ? (
            <Button variant="ghost" size="sm" onClick={() => abortRef.current?.abort()}>
              Cancel
            </Button>
          ) : null}
        </div>
        {readBack !== null ? (
          <p className="mt-3 break-all border border-border bg-muted/40 p-3 font-mono text-xs">
            {readBack || 'The card has no link on it.'}
          </p>
        ) : null}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {connected
            ? `${info?.deviceId ?? 'Reader'} · firmware ${info?.firmware ?? '—'} · NFC ${
                info?.nfcReady ? 'ready' : 'not ready'
              }`
            : 'Plug the reader into this computer, then select Connect reader. Use Chrome or Edge.'}
        </p>
        <pre className="mt-3 max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[0.7rem] leading-relaxed">
          {log.length > 0 ? log.join('\n') : 'No messages from the reader yet.'}
        </pre>
      </details>
    </div>
  );
}
