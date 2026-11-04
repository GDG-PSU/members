export const CARD_POLL_INTERVAL_MS = 50;

export function isNoCardError(error: unknown): boolean {
  return error instanceof Error && error.message === 'no_card';
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
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
