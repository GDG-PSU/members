import 'server-only';
import { decryptSecret, encryptSecret } from '@/lib/security/tokens';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

/**
 * Where reader keys are kept: `reader_keys`, one row per reader and version,
 * sealed with CARD_WRITE_ENCRYPTION_KEY so the database alone cannot open one.
 * Callers must have authorized the organizer first. A key read here is used to
 * answer a handshake or is handed to the reader; it is never logged or audited.
 */

export type StoredReaderKey = {
  key: Buffer;
  /** Versions older than this one are still stored and can be retired. */
  hasOlder: boolean;
};

/**
 * Stores a key at `version`, or at the next free version when none is given.
 * A version that already holds a key keeps it; read it back with loadReaderKey.
 */
export async function storeReaderKey(input: {
  deviceId: string;
  key: Buffer;
  actor: string;
  version?: number;
}): Promise<number | null> {
  const { data, error } = await createSupabaseAdmin().rpc('store_reader_key', {
    p_device_id: input.deviceId,
    p_version: input.version ?? null,
    p_sealed_key: encryptSecret(input.key.toString('base64url')),
    p_actor: input.actor,
  });
  if (error || typeof data !== 'number') {
    console.error('[reader] a key could not be stored', error?.message);
    return null;
  }
  return data;
}

export async function loadReaderKey(
  deviceId: string,
  version: number,
): Promise<StoredReaderKey | null> {
  const { data, error } = await createSupabaseAdmin()
    .from('reader_keys')
    .select('version, sealed_key')
    .eq('device_id', deviceId)
    .lte('version', version)
    .order('version', { ascending: false })
    .limit(2);
  if (error) {
    console.error('[reader] a key could not be read', error.message);
    return null;
  }
  const row = data?.[0];
  if (!row || row.version !== version) return null;

  try {
    const key = Buffer.from(decryptSecret(row.sealed_key as string), 'base64url');
    return key.length === 32 ? { key, hasOlder: (data?.length ?? 0) > 1 } : null;
  } catch {
    // Sealed under a different CARD_WRITE_ENCRYPTION_KEY: as good as unknown.
    console.error('[reader] a stored key could not be opened');
    return null;
  }
}

/** Removes the keys older than the version a reader has proved it holds. */
export async function retireReaderKeys(deviceId: string, version: number): Promise<void> {
  const { error } = await createSupabaseAdmin().rpc('retire_reader_keys', {
    p_device_id: deviceId,
    p_version: version,
  });
  if (error) console.error('[reader] old keys could not be retired', error.message);
}
