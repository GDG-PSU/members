import type {
  ReaderEvent,
  ReaderInfo,
  ReaderResponse,
  ReaderTransport,
} from '@/lib/reader/protocol';

/** The link went away under a command; another link may be about to take over. */
export class LinkClosedError extends Error {
  constructor(message = 'Disconnected.') {
    super(message);
    this.name = 'LinkClosedError';
  }
}

export type LinkHooks = {
  /** A plain line from the reader, for the troubleshooting log. Never a card link. */
  onLog(line: string): void;
  onStatus(text: string): void;
  onEvent(event: ReaderEvent): void;
  /** The link ended without being asked to. */
  onLost(reason: string): void;
};

/** One way of reaching a reader. The commands are the same on both. */
export interface ReaderLink {
  readonly transport: ReaderTransport;
  readonly info: ReaderInfo | null;
  send(cmd: string, extra?: Record<string, unknown>, timeoutMs?: number): Promise<ReaderResponse>;
  close(): Promise<void>;
}

type Pending = {
  resolve: (response: ReaderResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Matches each reply to the command that asked for it. */
export class RequestTracker {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();

  get busy(): boolean {
    return this.pending.size > 0;
  }

  begin(timeoutMs: number): { id: number; response: Promise<ReaderResponse> } {
    const id = ++this.nextId;
    const response = new Promise<ReaderResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The device did not answer in time.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    return { id, response };
  }

  /** False when nothing was waiting for this reply. */
  settle(message: ReaderResponse): boolean {
    const pending = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
    if (!pending || typeof message.id !== 'number') return false;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) {
      pending.resolve(message);
    } else {
      pending.reject(new Error(message.error ?? 'Device error'));
    }
    return true;
  }

  cancel(id: number, error: Error) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  failAll(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads one line from the reader. Returns the reply or event it holds, or null
 * for a plain log line. A reply's contents are never logged: an nfc.read reply
 * holds a card link.
 */
export function parseReaderLine(
  line: string,
): { reply: ReaderResponse } | { event: ReaderEvent } | null {
  if (!line.startsWith('{')) return null;
  try {
    const message = JSON.parse(line) as Partial<ReaderResponse> & Partial<ReaderEvent>;
    if (typeof message.event === 'string') return { event: message as ReaderEvent };
    if (typeof message.ok === 'boolean') return { reply: message as ReaderResponse };
  } catch {
    // Not JSON after all; the caller logs that a line was dropped.
  }
  return null;
}
