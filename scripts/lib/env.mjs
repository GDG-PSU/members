import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { config } from 'dotenv';

/**
 * Loads environment for scripting without ever printing values.
 * Order: process env wins over .env.local, which wins over .env.
 */
export async function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    const full = path.join(process.cwd(), file);
    if (existsSync(full)) {
      config({ path: full, override: false, quiet: true });
    }
  }
  return process.env;
}
