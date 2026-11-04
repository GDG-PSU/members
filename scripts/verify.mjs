#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';

let failed = false;
function run(label, command) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, { shell: true, stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    failed = true;
    console.error(`FAIL: ${label} (exit ${result.status ?? 'unavailable'})`);
  }
}
function blocked(label, reason) {
  failed = true;
  console.error(`BLOCKED: ${label} — ${reason}`);
}

run('Formatting', 'pnpm format:check');
run('Lint', 'pnpm lint');
run('Typecheck', 'pnpm typecheck');
run('Unit tests', 'pnpm test');
run('Production build', 'pnpm build');
if (process.env.DATABASE_URL) run('Local database invariants and RLS', 'pnpm db:verify');
else
  blocked(
    'Database checks',
    'Set DATABASE_URL to a disposable local or staging Supabase database after applying migrations.',
  );
if (
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  process.env.CARD_WRITE_ENCRYPTION_KEY &&
  process.env.E2E_BASE_URL
) {
  run('Browser tests', 'pnpm e2e');
} else
  blocked(
    'Browser tests',
    'Start the app against disposable Supabase and set E2E_BASE_URL, Supabase test credentials, and CARD_WRITE_ENCRYPTION_KEY.',
  );
run('Firmware build', 'pio run -d firmware/kiosk-reader');
run('Dependency audit', 'pnpm audit');
blocked(
  'Complete release coverage',
  'Required pgTAP, full API/E2E, accessibility, responsive visual, shared firmware signature-vector, and secret-scanning gates are not yet implemented.',
);
process.exit(failed ? 1 : 0);
