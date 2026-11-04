import 'server-only';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

/**
 * Counts one hit against a Postgres-backed bucket. Fails open: a limiter outage
 * should not lock everyone out, and Supabase Auth keeps its own limits.
 */
export async function withinRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await createSupabaseAdmin().rpc('consume_rate_limit', {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error('[rate-limit] check failed', error.message);
    return true;
  }
  return data !== false;
}
