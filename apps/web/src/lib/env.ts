import { z } from 'zod';

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url(),
  NEXT_PUBLIC_SUPPORT_EMAIL: z.email(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  /** Publishable (or legacy anon) key: safe for the browser, subject to RLS. */
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().trim().min(1),
  /** Secret/service key: server only, bypasses RLS, admin operations only. */
  SUPABASE_SECRET_KEY: z.string().trim().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().optional(),
  CARD_WRITE_ENCRYPTION_KEY: z.string().min(32, 'CARD_WRITE_ENCRYPTION_KEY must be 32+ chars'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid server environment (${fields}). See .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

/** Key for cookie-bound, user-scoped clients. Never the secret key. */
export function supabasePublicKey(): string {
  return getEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

/** Service key for privileged server operations. Never reaches the browser. */
export function supabaseAdminKey(): string {
  const env = getEnv();
  const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required server-side.');
  }
  return key;
}

export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'gdg@psu.edu';
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
