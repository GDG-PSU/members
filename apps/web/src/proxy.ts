import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getEnv, supabasePublicKey } from '@/lib/env';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = getEnv();

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, supabasePublicKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected =
    path.startsWith('/member') ||
    path.startsWith('/admin') ||
    path === '/admin-mfa' ||
    path === '/invite/accept' ||
    path === '/account-suspended';

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  if (user && (path === '/login' || path === '/forgot-password')) {
    const url = request.nextUrl.clone();
    url.pathname = '/member';
    url.search = '';
    return NextResponse.redirect(url);
  }

  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

export const config = {
  matcher: [
    '/member/:path*',
    '/admin/:path*',
    '/admin-mfa',
    '/invite/:path*',
    '/account-suspended',
    '/login',
    '/forgot-password',
  ],
};
