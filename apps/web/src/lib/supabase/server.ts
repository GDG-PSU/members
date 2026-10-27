import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getEnv, supabasePublicKey } from '@/lib/env';

/**
 * Cookie-bound Supabase client used for all interactive/user-scoped requests.
 *
 * Uses the publishable key, so every query is subject to Postgres RLS; signed-in
 * requests carry the user's access token. Privileged operations that legitimately
 * need to bypass RLS use `createSupabaseAdmin()` instead.
 */
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  const env = getEnv();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, supabasePublicKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render: the proxy refreshes cookies.
        }
      },
    },
  });
}
