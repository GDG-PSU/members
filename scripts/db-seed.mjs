#!/usr/bin/env node
/**
 * Development/demo seed. NEVER run this against production member data.
 *
 * Hard guards:
 *   SEED_CONFIRM=yes SEED_ALLOWED=1 node scripts/db-seed.mjs
 * and the database host must be localhost OR SEED_ALLOW_HOSTED=yes must be set
 * explicitly. All people below are fictional and use example.test addresses.
 *
 * Creates queued, clearly fictional members directly (no invitation emails),
 * one published event, rewards, and a couple of ledger grants so the UI has
 * something to render. It is idempotent by fixed UUIDs.
 */
import process from 'node:process';
import { Client } from 'pg';
import { loadEnv } from './lib/env.mjs';

const env = await loadEnv();
const isLocal = /localhost|127\.0\.0\.1/.test(env.DATABASE_URL ?? '');

if (env.SEED_CONFIRM !== 'yes' || env.SEED_ALLOWED !== '1') {
  console.error('Refusing to seed. Set SEED_CONFIRM=yes and SEED_ALLOWED=1 explicitly.');
  process.exit(1);
}
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
if (!isLocal && env.SEED_ALLOW_HOSTED !== 'yes') {
  console.error('Hosted database seed requires SEED_ALLOW_HOSTED=yes. This is for demos only.');
  process.exit(1);
}

const DEMO_MEMBERS = [
  [
    '11111111-1111-4111-8111-111111111101',
    'demo.ada@example.test',
    'Ada Demo',
    'GDG-DEMO01',
    'demo-profile-ada-aaaaaaaa',
  ],
  [
    '11111111-1111-4111-8111-111111111102',
    'demo.blake@example.test',
    'Blake Sample',
    'GDG-DEMO02',
    'demo-profile-blake-bbbbbbbb',
  ],
  [
    '11111111-1111-4111-8111-111111111103',
    'demo.casey@example.test',
    'Casey Fixture',
    'GDG-DEMO03',
    'demo-profile-casey-cccccccc',
  ],
];

const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});
await client.connect();

try {
  await client.query('begin');

  for (const [id, email, name, number, slug] of DEMO_MEMBERS) {
    await client.query(
      // GoTrue's admin API scans these columns into non-nullable values, so a
      // partial row makes /auth/v1/admin/users fail with a 500.
      `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at,
         raw_app_meta_data, raw_user_meta_data, email_change_confirm_status)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{"email_verified":true}'::jsonb, 0)
       on conflict (id) do nothing`,
      [id, email],
    );
    await client.query(
      `insert into public.members (id, auth_user_id, public_number, member_since)
       values ($1, $1, $3, current_date - 120)
       on conflict (id) do nothing`,
      [id, id, number],
    );
    await client.query(
      `insert into public.member_private (member_id, email) values ($1, $2)
       on conflict (member_id) do nothing`,
      [id, email],
    );
    await client.query(
      `insert into public.member_profiles (member_id, profile_slug, display_name, photo_path, about)
       values ($1, $3, $2, 'member/demo/placeholder.webp', 'Fictional demo member for local development.')
       on conflict (member_id) do nothing`,
      [id, name, slug],
    );
    await client.query(
      `select public.grant_points($1::uuid, 25, 'admin_adjustment', $2::text, 'Demo seed grant')`,
      [id, `demo:grant:${id}`],
    );
  }

  const eventId = '22222222-2222-4222-8222-222222222201';
  await client.query(
    `insert into public.events (id, name, slug, summary, location, starts_at, ends_at, status)
     values ($1, 'Demo Build Night', 'demo-build-night', 'Fictional local demo event.', 'Demo Hall', now() + interval '3 days', now() + interval '3 days 3 hours', 'published')
     on conflict (id) do nothing`,
    [eventId],
  );
  await client.query(
    `insert into public.event_sessions (
       event_id, name, kind, starts_at, ends_at, check_in_opens_at, check_in_closes_at,
       check_out_opens_at, check_out_closes_at, minimum_duration_minutes, reward_points
     )
     select $1, 'Main session', 'main', starts_at, ends_at,
            starts_at - interval '30 minutes', starts_at + interval '1 hour',
            starts_at, ends_at, 30, 10
     from public.events where id = $1
     on conflict do nothing`,
    [eventId],
  );
  await client.query(
    `insert into public.rewards (name, description, cost_points, inventory)
     values ('Demo sticker pack', 'Fictional reward for local UI development.', 10, 25),
            ('Demo mug', 'Fictional reward for local UI development.', 30, 5)
     on conflict do nothing`,
  );

  await client.query('commit');
  console.log('Demo fixtures seeded (fictional example.test accounts only).');
} catch (error) {
  await client.query('rollback');
  console.error(`Seed failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
