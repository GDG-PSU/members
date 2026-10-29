#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql in filename order, each in a transaction,
 * recording applied files in public.applied_migrations.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/db-migrate.mjs [--dry-run]
 *
 * Legacy runner for databases initialized with this script only. It does not
 * share migration history with the Supabase CLI or GitHub integration.
 * Use the Supabase CLI for new databases and never mix the two runners.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Client } from 'pg';
import { loadEnv } from './lib/env.mjs';

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
const dryRun = process.argv.includes('--dry-run');

const env = await loadEnv();
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is required (see .env.example).');
  process.exit(1);
}

const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

await client.connect();

// Replaying these migrations on a CLI-managed database can temporarily make the
// avatars bucket public, even if a later migration normally makes it private.
const { rows: historyTable } = await client.query(
  "select to_regclass('supabase_migrations.schema_migrations') as name",
);
if (historyTable[0].name) {
  const { rows: history } = await client.query(
    'select exists(select 1 from supabase_migrations.schema_migrations) as has_migrations',
  );
  if (history[0].has_migrations) {
    console.error(
      'Refusing to run: this database has Supabase CLI migration history. Use the Supabase CLI; never mix migration runners.',
    );
    await client.end();
    process.exit(1);
  }
}

await client.query(`
  create table if not exists public.applied_migrations (
    name text primary key,
    applied_at timestamptz not null default now(),
    checksum text
  );
`);

const { rows } = await client.query('select name from public.applied_migrations');
const applied = new Set(rows.map((row) => row.name));

const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
let appliedCount = 0;

for (const file of files) {
  if (applied.has(file)) {
    console.log(`skip  ${file}`);
    continue;
  }
  const sql = await readFile(path.join(migrationsDir, file), 'utf8');
  if (dryRun) {
    console.log(`dry   ${file} (${sql.length} bytes)`);
    continue;
  }
  console.log(`apply ${file}`);
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into public.applied_migrations (name) values ($1)', [file]);
    await client.query('commit');
    appliedCount += 1;
  } catch (error) {
    await client.query('rollback');
    console.error(`failed ${file}: ${error.message}`);
    if (error.position) {
      const upto = sql.slice(0, Number(error.position));
      console.error(`at line ${upto.split('\n').length}`);
    }
    await client.end();
    process.exit(1);
  }
}

console.log(`done: ${appliedCount} migration(s) applied${dryRun ? ' (dry run)' : ''}`);
await client.end();
