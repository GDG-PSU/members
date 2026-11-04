import { createHash } from 'node:crypto';

const AUTH_NEXT_PATHS = new Set(['/invite/accept', '/admin-mfa', '/account/password', '/member']);
const DEFAULT_AUTH_NEXT = '/invite/accept';

/**
 * Where an auth link may land. An exact allowlist, because prefix checks miss
 * forms such as `/\evil.example` that browsers normalize to another origin.
 */
export function safeAuthNextPath(next: string | null | undefined): string {
  return next && AUTH_NEXT_PATHS.has(next) ? next : DEFAULT_AUTH_NEXT;
}

/** For cookie-changing route handlers, which do not get the Server Action origin check. */
export function isSameOriginRequest(request: Request, siteUrl: string): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const { host, origin: normalized } = new URL(origin);
    const requestHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    return host === requestHost || normalized === new URL(siteUrl).origin;
  } catch {
    return false;
  }
}

export function clientAddress(headers: Headers): string {
  const forwarded = headers.get('x-vercel-forwarded-for') ?? headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
}

/** Keeps addresses and emails out of rate_limit_counters. */
export function hashForBucket(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32);
}
