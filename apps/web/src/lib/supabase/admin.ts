import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv, supabaseAdminKey } from '@/lib/env';

let cached: SupabaseClient | null = null;

/**
 * Server-only client with service privileges. Never import this from a Client
 * Component. Callers must authorize the actor before using it.
 */
export function createSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const env = getEnv();
  cached = createClient(env.NEXT_PUBLIC_SUPABASE_URL, supabaseAdminKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-application-name': 'gdgpsu-members' } },
  });
  return cached;
}
