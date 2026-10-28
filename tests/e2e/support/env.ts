import { config as loadEnv } from 'dotenv';

/** Loads the local development environment for the test runner only. */
export function loadTestEnv(): void {
  loadEnv({ path: ['.env.local', 'apps/web/.env.local'], quiet: true });
}

export function baseUrl(): string {
  return process.env.E2E_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3100';
}

export function siteOrigin(): string {
  return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? baseUrl()).origin;
}

export function hasSupabaseAdminCredentials(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
}
