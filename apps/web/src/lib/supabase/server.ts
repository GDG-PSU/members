import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getEnv, supabaseApiKey } from '@/lib/env';

/**
 * Cookie-bound Supabase client used for all interactive/user-scoped requests.
 *
 * The project currently exposes only a server-side secret key (no publishable
 * key), so the key never leaves the server. Once a user signs in, the SDK sends
 * the user's access token instead, and Postgres RLS applies normally.
 */
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  const env = getEnv();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, supabaseApiKey(), {
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
