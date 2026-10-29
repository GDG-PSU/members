#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
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
mkdirSync('.local', { recursive: true });
const hostTestPath = path.resolve(
  '.local',
  process.platform === 'win32' ? 'ndef_test.exe' : 'ndef_test',
);
run(
  'NDEF parser host tests',
  `g++ -std=c++17 -Wall -Wextra -Werror -I firmware/kiosk-reader/lib/ndef_url firmware/kiosk-reader/test/host/test_ndef_url.cpp firmware/kiosk-reader/lib/ndef_url/ndef_url.cpp -o "${hostTestPath}" && "${hostTestPath}"`,
);
if (existsSync('firmware/kiosk-reader/include/secrets.h'))
  run('Firmware build', 'pio run -d firmware/kiosk-reader');
else
  blocked(
    'Firmware build',
    'Provide ignored firmware/kiosk-reader/include/secrets.h and install PlatformIO.',
  );
run('Dependency audit', 'pnpm audit');
blocked(
  'Complete release coverage',
  'Required pgTAP, full API/E2E, accessibility, responsive visual, shared firmware signature-vector, and secret-scanning gates are not yet implemented.',
);
process.exit(failed ? 1 : 0);
