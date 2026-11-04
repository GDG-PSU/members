import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getEnv, supabaseCookieOptions, supabasePublicKey } from '@/lib/env';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = getEnv();

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, supabasePublicKey(), {
    cookieOptions: supabaseCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A refresh above rotated the refresh token, so a redirect must carry the new
  // cookies or the next request replays the old token and ends the session.
  const redirectTo = (pathname: string, next?: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = '';
    if (next) url.searchParams.set('next', next);
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  };

  const path = request.nextUrl.pathname;
  const isProtected =
    path.startsWith('/member') ||
    path.startsWith('/admin') ||
    path === '/admin-mfa' ||
    path === '/invite/accept' ||
    path === '/account-suspended';

  if (!user && isProtected) {
    return redirectTo('/login', path);
  }

  // /login sends each user type to its own home.
  if (user && path === '/forgot-password') {
    return redirectTo('/login');
  }

  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

export const config = {
  // Everything that renders the root layout, because it reads the session. A
  // Server Component cannot write cookies, so a token refresh is only persisted
  // if this runs first. Route handlers (/api, /c) can write their own.
  matcher: [
    '/((?!api/|c/|_next/static|_next/image|favicon\\.ico|.*\\.(?:png|svg|ico|webp|jpg|jpeg|txt|xml)$).*)',
  ],
};
