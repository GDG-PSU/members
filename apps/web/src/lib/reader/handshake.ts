import { fromBase64Url, toBase64Url, type ReaderResponse } from '@/lib/reader/protocol';
import { SecureChannel } from '@/lib/reader/secure-channel';

export type ReaderSessionGrant =
  | { ok: true; proof: string; expect: string; sessionKey: string; older?: boolean }
  | { ok: false; error: string };

export type ReaderKeyGrant =
  { ok: true; key: string; epoch: number; check: string } | { ok: false; error: string };

type ReaderRef = { deviceId: string; epoch: number };

/**
 * What the server does for a reader link. It holds every reader's key, so the
 * browser asks it to vouch, and it does so only for a signed-in organizer.
 */
export type ReaderBroker = {
  /** Vouches for this browser to one reader, for one session. */
  openSession(
    input: ReaderRef & { clientNonce: string; readerNonce: string },
  ): Promise<ReaderSessionGrant>;
  /** Makes and stores a key for a reader on the cable that has none. */
  registerReader(input: { deviceId: string }): Promise<ReaderKeyGrant>;
  /** Makes the key that replaces the one a connected reader holds. */
  rotateKey(input: ReaderRef): Promise<ReaderKeyGrant>;
  /** The reader has proved it holds this version, so older ones can be retired. */
  confirmKey(input: ReaderRef): Promise<unknown>;
};

export const NOT_OURS = 'That is not a reader this site knows. Nothing was sent to it.';

/**
 * Opens a session on a link that is still in the clear. Before a single command
 * is sent, the reader has to prove it holds its key and this browser has to
 * prove a signed-in organizer is behind it; every line after that is sealed.
 * `send` writes one unsealed command and resolves with its reply.
 */
export async function openReaderSession(
  send: (cmd: string, extra: Record<string, unknown>) => Promise<ReaderResponse>,
  broker: ReaderBroker,
): Promise<SecureChannel> {
  const clientNonce = crypto.getRandomValues(new Uint8Array(16));
  const begun = await send('auth.begin', { nonce: toBase64Url(clientNonce) });
  const { deviceId, epoch, nonce: readerNonce } = begun.result ?? {};
  if (!deviceId || typeof epoch !== 'number' || !readerNonce) throw new Error(NOT_OURS);

  const grant = await broker.openSession({
    deviceId,
    epoch,
    clientNonce: toBase64Url(clientNonce),
    readerNonce,
  });
  if (!grant.ok) throw new Error(grant.error);

  const finished = await send('auth.finish', { proof: grant.proof });
  const sessionKey = fromBase64Url(grant.sessionKey);
  // Only a reader holding its key can give this answer.
  if (finished.result?.proof !== grant.expect || !sessionKey) throw new Error(NOT_OURS);
  const channel = await SecureChannel.create(sessionKey);

  if (grant.older) {
    // A key change that never finished: the reader has the new key, so the old goes.
    void Promise.resolve(broker.confirmKey({ deviceId, epoch })).catch(() => {});
  }
  return channel;
}
