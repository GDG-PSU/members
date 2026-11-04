#!/usr/bin/env node
/**
 * Empties a database so the app starts from nothing: every Auth user and session,
 * all application rows including the audit log and invitation history, the rate
 * limit counters, and every profile photo. The schema and migration history stay.
 *
 * This cannot be undone. Run with no arguments to see what would be removed, then
 * pass the project ref that the dry run prints:
 *
 *   node scripts/db-reset.mjs
 *   node scripts/db-reset.mjs --confirm <project-ref>
 *
 * Requires DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, and a Supabase secret key.
 */
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { loadEnv } from './lib/env.mjs';

const env = await loadEnv();
const apiKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
if (!env.DATABASE_URL || !env.NEXT_PUBLIC_SUPABASE_URL || !apiKey) {
  console.error('DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and a Supabase secret key are required.');
  process.exit(1);
}

const apiHost = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
const isLocalDatabase = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(env.DATABASE_URL);
const isLocalApi = ['localhost', '127.0.0.1', '::1'].includes(apiHost);
if (isLocalDatabase !== isLocalApi) {
  // Otherwise the rows of one project and the photos of another could be erased.
  console.error('DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL point at different projects.');
  process.exit(1);
}
const projectRef = isLocalApi ? 'local' : apiHost.split('.')[0];

const confirmIndex = process.argv.indexOf('--confirm');
const confirmation = confirmIndex >= 0 ? process.argv[confirmIndex + 1] : undefined;

const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
});
const storage = createClient(env.NEXT_PUBLIC_SUPABASE_URL, apiKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage.from('avatars');

async function publicTables() {
  const { rows } = await client.query(
    `select c.relname as name
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
     order by 1`,
  );
  return rows.map((row) => row.name);
}

async function counts(tables) {
  const result = {};
  for (const table of tables) {
    const { rows } = await client.query(`select count(*)::int as n from public."${table}"`);
    result[table] = rows[0].n;
  }
  for (const table of ['users', 'sessions', 'mfa_factors']) {
    const { rows } = await client.query(`select count(*)::int as n from auth."${table}"`);
    result[`auth.${table}`] = rows[0].n;
  }
  const { rows } = await client.query(
    `select count(*)::int as n from storage.objects where bucket_id = 'avatars'`,
  );
  result['storage: avatars'] = rows[0].n;
  return result;
}

function print(title, values) {
  console.log(title);
  for (const [name, value] of Object.entries(values)) {
    if (value > 0) console.log(`  ${name.padEnd(28)} ${value}`);
  }
  if (Object.values(values).every((value) => value === 0)) console.log('  (nothing)');
}

/** Photos live under member/<auth user id>/<file>, or directly in the bucket. */
async function allPhotos(prefix = '') {
  const paths = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await storage.list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`Could not list photos: ${error.message}`);
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Folders have no id in a storage listing.
      if (entry.id) paths.push(path);
      else paths.push(...(await allPhotos(path)));
    }
    if (data.length < 1000) return paths;
  }
}

await client.connect();
let exitCode = 0;
try {
  const tables = await publicTables();
  console.log(`Target project: ${projectRef}`);
  print('Currently holds:', await counts(tables));

  if (confirmation === undefined) {
    console.log(`\nDry run: nothing was changed. To erase all of this permanently, run:`);
    console.log(`  pnpm db:reset --confirm ${projectRef}`);
  } else if (confirmation !== projectRef) {
    console.error(`\n--confirm must be "${projectRef}". Nothing was changed.`);
    exitCode = 1;
  } else {
    // One transaction: a failure leaves the database as it was. Truncate fires no
    // row triggers, and the erasure flag covers the guards on the auth.users cascade.
    await client.query('begin');
    await client.query(`select set_config('app.member_erasure', 'on', true)`);
    await client.query(
      `truncate ${tables.map((table) => `public."${table}"`).join(', ')} restart identity cascade`,
    );
    await client.query('delete from auth.users');
    await client.query('delete from auth.audit_log_entries');
    await client.query('commit');
    console.log('\nDatabase emptied.');

    // After the commit, because storage cannot roll back. Re-running is safe.
    const photos = await allPhotos();
    for (let index = 0; index < photos.length; index += 100) {
      const { error } = await storage.remove(photos.slice(index, index + 100));
      if (error) throw new Error(`Could not remove photos: ${error.message}`);
    }
    console.log(`Removed ${photos.length} photo(s).`);

    print('\nNow holds:', await counts(tables));
  }
} catch (error) {
  await client.query('rollback').catch(() => {});
  console.error(`Reset failed: ${error.message}`);
  exitCode = 1;
} finally {
  await client.end();
}
process.exit(exitCode);
