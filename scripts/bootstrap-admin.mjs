#!/usr/bin/env node
/**
 * Grants the `admin` role to an existing (or newly created) Supabase Auth user
 * and generates a one-time recovery link so they can set their own password.
 * No email is sent; the link is written to --out for the operator to deliver.
 *
 *   node scripts/bootstrap-admin.mjs --email you@psu.edu --out .local/admin-link.txt
 *
 * Requires SUPABASE_SECRET_KEY (or legacy service role key) and DATABASE_URL.
 * No password is generated, printed or stored by this script.
 */
import process from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { loadEnv } from './lib/env.mjs';

const env = await loadEnv();
const emailIndex = process.argv.indexOf('--email');
const email = emailIndex >= 0 ? process.argv[emailIndex + 1]?.trim().toLowerCase() : '';

if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/bootstrap-admin.mjs --email you@psu.edu');
  process.exit(1);
}
if (!env.DATABASE_URL || !env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error('DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL are required.');
  process.exit(1);
}
const apiKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
if (!apiKey) {
  console.error('SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required.');
  process.exit(1);
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '');
const siteUrl = env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

const headers = {
  apikey: apiKey,
  authorization: `Bearer ${apiKey}`,
  'content-type': 'application/json',
};

async function findUser() {
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: apiKey, authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) throw new Error(`list users failed (${response.status})`);
    const body = await response.json();
    const users = body.users ?? [];
    const match = users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (users.length < 200) return null;
  }
  return null;
}

async function createUser() {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email,
      email_confirm: true,
      password: randomBytes(32).toString('base64url'),
      user_metadata: { bootstrap: true },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`create user failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return (await response.json()).user ?? (await response.json());
}

let user = await findUser();
if (!user) {
  console.log(`Creating Auth user ${email} (no password will be shown).`);
  const created = await createUser();
  user = created.user ?? created;
} else {
  console.log(`Auth user already exists for ${email}.`);
}
if (!user?.id) throw new Error('Could not determine Auth user id.');

const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});
await client.connect();
await client.query(
  `insert into public.user_roles (auth_user_id, role, note)
   values ($1, 'admin', 'bootstrap script')
   on conflict (auth_user_id, role) do update set revoked_at = null, revoked_by = null, granted_at = now()`,
  [user.id],
);
await client.query(
  `insert into public.audit_log (actor_auth_id, action, target_type, target_id)
   values (null, 'admin.bootstrap_granted', 'user', $1)`,
  [user.id],
);
await client.end();

const recovery = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    type: 'recovery',
    email,
  }),
});

console.log(`Granted admin role to ${email}.`);
if (recovery.ok) {
  const body = await recovery.json();
  const properties = body.properties ?? body;
  // Confirm on our own origin: Supabase rewrites redirect_to to its allowlisted
  // Site URL, which breaks links when the deployment uses a custom domain.
  const link = properties?.hashed_token
    ? (() => {
        const url = new URL('/auth/confirm', siteUrl);
        url.searchParams.set('token_hash', properties.hashed_token);
        url.searchParams.set('type', properties.verification_type ?? 'recovery');
        url.searchParams.set('next', '/account/password');
        return url.toString();
      })()
    : (body.action_link ?? properties?.action_link);
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : '';
  if (link && outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${link}\n`, { mode: 0o600 });
    console.log(`Recovery link written to ${outPath}. Send it privately, then delete the file.`);
  } else if (link) {
    console.log('Recovery link generated but not printed. Re-run with --out <path> to save it.');
  } else {
    console.log(
      'No recovery link was returned. Generate one from the admin member page once signed in.',
    );
  }
} else {
  console.log(
    'Admin role granted, but the recovery link could not be generated. Set a password in Supabase.',
  );
}
console.log('The user must set a password, then enroll TOTP at /admin-mfa before /admin opens.');
