import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CARD_POLL_INTERVAL_MS,
  isAbortError,
  isReaderFault,
  laneErrorMessage,
  waitForCard,
  waitForCardRemoved,
} from './wait-for-card';

afterEach(() => {
  vi.useRealTimers();
});

describe('laneErrorMessage', () => {
  it('explains firmware codes in words', () => {
    expect(laneErrorMessage(new Error('nfc_not_ready'))).toContain('not responding');
    expect(laneErrorMessage(new Error('ndef_record_missing'))).toContain('no readable URL');
    expect(laneErrorMessage(new Error('read_back_mismatch'))).toContain('did not save');
    expect(laneErrorMessage(new Error('tag_too_small'))).toContain('too long');
  });

  it('leaves messages already written for people alone', () => {
    expect(laneErrorMessage(new Error('That member is not active.'))).toBe(
      'That member is not active.',
    );
    expect(laneErrorMessage('Disconnected.')).toBe('Disconnected.');
  });
});

describe('waitForCard', () => {
  it('retries an empty reader until a card appears', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let attempts = 0;

    const promise = waitForCard(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('no_card');
      return 'https://example.test/c/card';
    }, controller.signal);

    await vi.advanceTimersByTimeAsync(CARD_POLL_INTERVAL_MS * 2);

    await expect(promise).resolves.toBe('https://example.test/c/card');
    expect(attempts).toBe(3);
  });

  it('keeps waiting past ten seconds until cancelled', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let attempts = 0;

    const promise = waitForCard(async () => {
      attempts += 1;
      throw new Error('no_card');
    }, controller.signal);
    const outcome = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10_250);
    expect(attempts).toBeGreaterThan(40);

    controller.abort();
    expect(isAbortError(await outcome)).toBe(true);
  });

  it('surfaces any non-empty-reader error immediately', async () => {
    const operation = vi.fn(async () => {
      throw new Error('unsupported_tag');
    });

    await expect(waitForCard(operation, new AbortController().signal)).rejects.toThrow(
      'unsupported_tag',
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not start a card operation after cancellation', async () => {
    const controller = new AbortController();
    const operation = vi.fn(async () => 'never');
    controller.abort();

    await expect(waitForCard(operation, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(operation).not.toHaveBeenCalled();
  });
});

describe('waitForCardRemoved', () => {
  it('waits while the same card, or an unreadable one, is still on the reader', async () => {
    vi.useFakeTimers();
    const replies: Array<() => Promise<string>> = [
      async () => 'https://example.test/c/card',
      async () => {
        throw new Error('ndef_record_missing');
      },
      async () => {
        throw new Error('no_card');
      },
    ];
    const read = vi.fn(() => (replies.shift() ?? replies[0])!());

    const promise = waitForCardRemoved(read, new AbortController().signal, 100);
    await vi.advanceTimersByTimeAsync(250);

    await expect(promise).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('hands a reader fault back to the caller instead of waiting forever', async () => {
    const read = vi.fn(async () => {
      throw new Error('nfc_not_ready');
    });

    await expect(waitForCardRemoved(read, new AbortController().signal)).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
    expect(isReaderFault(new Error('nfc_not_ready'))).toBe(true);
    expect(isReaderFault(new Error('unsupported_tag'))).toBe(false);
  });

  it('stops when cancelled', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const outcome = waitForCardRemoved(async () => 'still here', controller.signal, 100).catch(
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(150);
    controller.abort();

    expect(isAbortError(await outcome)).toBe(true);
  });
});
