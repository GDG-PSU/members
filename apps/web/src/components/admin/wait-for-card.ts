export const CARD_POLL_INTERVAL_MS = 50;

export function isNoCardError(error: unknown): boolean {
  return error instanceof Error && error.message === 'no_card';
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

const READER_FAULTS = new Set([
  'nfc_not_ready',
  'nfc_unavailable',
  'The device did not answer in time.',
]);

/** The reader itself is in trouble, so whether a card is on it cannot be known. */
export function isReaderFault(error: unknown): boolean {
  return error instanceof Error && READER_FAULTS.has(error.message);
}

const NOT_READY = 'The NFC module is not responding. Check its connection to the reader.';
const UNSUPPORTED = 'This card type is not supported. Use an NTAG213 or NTAG215 card.';
const UNREADABLE = 'The card could not be read. Hold it flat on the reader and try again.';
const NOT_SAVED = 'The card did not save correctly. Hold it flat on the reader and write it again.';
const NO_URL = 'This card has no readable URL on it. Write it from the Cards page first.';
const TOO_LONG = 'That URL is too long for this card.';

const LANE_ERRORS: Record<string, string> = {
  nfc_not_ready: NOT_READY,
  nfc_unavailable: NOT_READY,
  unsupported_tag: UNSUPPORTED,
  tag_capacity_unexpected: UNSUPPORTED,
  capacity_unknown: UNSUPPORTED,
  capability_read_failed: UNREADABLE,
  page_read_failed: UNREADABLE,
  page_write_failed: NOT_SAVED,
  read_back_mismatch: NOT_SAVED,
  ndef_empty: NO_URL,
  ndef_record_missing: NO_URL,
  ndef_not_first_record: NO_URL,
  not_uri_record: NO_URL,
  truncated_tlv: NO_URL,
  truncated_record: NO_URL,
  truncated_payload: NO_URL,
  unsupported_uri_prefix: NO_URL,
  uri_not_printable: NO_URL,
  uri_too_long: TOO_LONG,
  tag_too_small: TOO_LONG,
};

/** Firmware reports short codes; anything else is already written for people. */
export function laneErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return LANE_ERRORS[message] ?? message;
}

function cancelledError(): Error {
  const error = new Error('Waiting for a card was cancelled.');
  error.name = 'AbortError';
  return error;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelledError());
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);

    function handleAbort() {
      clearTimeout(timer);
      reject(cancelledError());
    }

    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

/**
 * Retries a card operation while the reader reports an empty antenna. There is
 * deliberately no timeout: an admin may need time to find or reposition a card.
 * Any error other than `no_card` is surfaced immediately.
 */
export async function waitForCard<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  intervalMs = CARD_POLL_INTERVAL_MS,
): Promise<T> {
  while (true) {
    if (signal.aborted) throw cancelledError();

    try {
      const result = await operation();
      if (signal.aborted) throw cancelledError();
      return result;
    } catch (error) {
      if (signal.aborted) throw cancelledError();
      if (!isNoCardError(error)) throw error;
    }

    await wait(intervalMs, signal);
  }
}

/**
 * Resolves once the reader reports an empty antenna. A card left on the reader
 * after it was handled must not be read again as if it were the next person's.
 * A reader fault also resolves, so the caller's next read can report it.
 */
export async function waitForCardRemoved(
  read: () => Promise<unknown>,
  signal: AbortSignal,
  intervalMs = 150,
): Promise<void> {
  while (true) {
    if (signal.aborted) throw cancelledError();

    try {
      await read();
    } catch (error) {
      if (signal.aborted) throw cancelledError();
      if (isNoCardError(error) || isReaderFault(error)) return;
    }

    await wait(intervalMs, signal);
  }
}
