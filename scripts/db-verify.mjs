#!/usr/bin/env node
/**
 * Database integration verification.
 *
 * Most checks run in a transaction that is rolled back. The concurrency checks
 * need committed rows and clean up after themselves, but a failed run can leave
 * them behind, so this is for a disposable local/staging database only. A
 * non-local host must be allowed explicitly with DB_VERIFY_ALLOW_HOSTED=yes.
 *
 *   node scripts/db-verify.mjs
 *
 * Covers: API role privileges, ledger idempotency and stars, redemption
 * inventory/balance races, attendance windows/threshold/duplicate handling,
 * reversals and re-qualification, card lifecycle, the last-superadmin guard and
 * RLS (member isolation, private profiles, anon denial).
 */
import process from 'node:process';
import { Client } from 'pg';
import { loadEnv } from './lib/env.mjs';

const env = await loadEnv();
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(env.DATABASE_URL);
if (!isLocal && env.DB_VERIFY_ALLOW_HOSTED !== 'yes') {
  console.error(
    'Refusing to run against a non-local database. Use a disposable database, or set DB_VERIFY_ALLOW_HOSTED=yes for a staging project. Never run this against production.',
  );
  process.exit(1);
}
const ssl = isLocal ? false : { rejectUnauthorized: false };

const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl,
  connectionTimeoutMillis: 15000,
});

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function expectError(name, sql, params, expectedFragment) {
  try {
    await client.query('savepoint expect_error');
    await client.query(sql, params);
    await client.query('release savepoint expect_error');
    check(name, false, 'expected an error, none raised');
  } catch (error) {
    await client.query('rollback to savepoint expect_error');
    check(name, String(error.message).includes(expectedFragment), `got: ${error.message}`);
  }
}

async function expectDenied(name, role, sql, params = []) {
  await client.query('savepoint denied_ctx');
  await client.query(`set local role ${role}`);
  try {
    await client.query(sql, params);
    check(name, false, 'expected permission denied');
  } catch (error) {
    check(name, /permission denied/i.test(error.message), `got: ${error.message}`);
  }
  await client.query('rollback to savepoint denied_ctx');
  await client.query('reset role');
  await client.query('release savepoint denied_ctx');
}

async function asUser(userId, fn, aal = 'aal1') {
  await client.query('savepoint rls_ctx');
  await client.query(`set local role authenticated`);
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: 'authenticated', aal }),
  ]);
  try {
    return await fn();
  } finally {
    await client.query('reset role');
    await client.query('release savepoint rls_ctx');
  }
}

await client.connect();
await client.query('begin');

try {
  // ---- API role privileges ---------------------------------------------------
  // Supabase grants EXECUTE on new public functions to anon and authenticated
  // directly, so `revoke ... from public` alone leaves them callable over
  // /rest/v1/rpc. This must stay empty whatever a future migration adds.
  const { rows: exposed } = await client.query(`
    select p.proname,
      has_function_privilege('anon', p.oid, 'execute') as anon,
      has_function_privilege('authenticated', p.oid, 'execute') as authenticated
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  `);
  const authenticatedHelpers = new Set(['current_member_id', 'is_admin', 'is_superadmin']);
  const anonCallable = exposed.filter((fn) => fn.anon).map((fn) => fn.proname);
  const memberCallable = exposed
    .filter((fn) => fn.authenticated && !authenticatedHelpers.has(fn.proname))
    .map((fn) => fn.proname);
  check('anon cannot execute any public function', anonCallable.length === 0, anonCallable.join());
  check(
    'authenticated can execute only the RLS helpers',
    memberCallable.length === 0,
    memberCallable.join(),
  );

  await expectDenied(
    'anon cannot read the public profile view',
    'anon',
    'select email from public.public_profiles',
  );
  await expectDenied(
    'authenticated cannot read the public profile view',
    'authenticated',
    'select email from public.public_profiles',
  );
  await expectDenied(
    'anon cannot read the leaderboard view',
    'anon',
    'select slug from public.leaderboard',
  );
  await expectDenied(
    'anon cannot touch rate limit counters',
    'anon',
    'select * from public.rate_limit_counters',
  );
  await expectDenied(
    'members cannot read organizer notes',
    'authenticated',
    'select admin_note from public.member_private',
  );
  await expectDenied(
    'API roles cannot read card tokens',
    'authenticated',
    'select token_ciphertext from public.card_credentials',
  );
  await expectDenied(
    'API roles cannot read card token hashes',
    'authenticated',
    'select token_hash from public.card_credentials',
  );
  await expectDenied(
    'API roles cannot read device secrets',
    'authenticated',
    'select secret_ciphertext from public.devices',
  );
  await expectDenied(
    'API roles cannot read write payloads',
    'authenticated',
    'select payload_ciphertext from public.card_write_jobs',
  );

  // GoTrue's admin API scans these columns into non-nullable values; a partial
  // row makes /auth/v1/admin/users fail with a 500 until it is repaired.
  const { rows: users } = await client.query(`
    insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, email_change_confirm_status)
    values
      ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'verify.admin@example.test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, 0),
      ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'verify.a@example.test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, 0),
      ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'verify.b@example.test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, 0)
    returning id, email
  `);
  const adminId = users.find((u) => u.email.startsWith('verify.admin')).id;
  const memberAId = users.find((u) => u.email === 'verify.a@example.test').id;
  const memberBId = users.find((u) => u.email === 'verify.b@example.test').id;

  await client.query(`insert into public.user_roles (auth_user_id, role) values ($1, 'admin')`, [
    adminId,
  ]);

  const { rows: members } = await client.query(
    `insert into public.members (auth_user_id, public_number, member_since) values
       ($1, 'GDG-VRFA01', current_date - 30),
       ($2, 'GDG-VRFB02', current_date - 20)
     returning id, auth_user_id`,
    [memberAId, memberBId],
  );
  const memberA = members[0].id;
  const memberB = members[1].id;

  await client.query(
    `insert into public.member_private (member_id, email) values ($1, 'verify.a@example.test'), ($2, 'verify.b@example.test')`,
    [memberA, memberB],
  );
  await client.query(
    `insert into public.member_profiles (member_id, profile_slug, display_name, photo_path, about, public_profile, show_points, show_on_leaderboard)
     values
       ($1, 'verify-profile-slug-aaaaaaaa', 'Verify A', 'member/a.webp', 'Hello', true, true, true),
       ($2, 'verify-profile-slug-bbbbbbbb', 'Verify B', 'member/b.webp', 'Hidden', false, true, true)`,
    [memberA, memberB],
  );

  // ---- Ledger: grant, idempotency, mirror stars -----------------------------
  const ledger = await client.query(
    `select public.grant_points($1, 100, 'interaction_reward', 'verify:grant:a', 'Verification grant', $2) as id`,
    [memberA, adminId],
  );
  const grantId = ledger.rows[0].id;

  const repeat = await client.query(
    `select public.grant_points($1, 100, 'interaction_reward', 'verify:grant:a', 'Verification grant', $2) as id`,
    [memberA, adminId],
  );
  check('grant is idempotent by source key', repeat.rows[0].id === grantId);
  const counts = await client.query(
    `select (select count(*) from public.point_ledger where source_key = 'verify:grant:a')::int as points,
            (select count(*) from public.star_ledger where source_key = 'star:verify:grant:a')::int as stars`,
  );
  check('one ledger row per idempotency key', counts.rows[0].points === 1);
  check('positive grant mirrors one star row', counts.rows[0].stars === 1);

  const balanceA = await client.query(
    `select points, stars from public.member_balances where member_id = $1`,
    [memberA],
  );
  check('points balance derived from ledger', balanceA.rows[0].points === 100);
  check('stars mirror points', balanceA.rows[0].stars === 100);

  // ---- Rewards / redemption -------------------------------------------------
  const { rows: rewardRows } = await client.query(
    `insert into public.rewards (name, description, cost_points, inventory) values
       ('Verification mug', 'Test reward', 40, 1),
       ('Too expensive', 'Test reward', 5000, 5)
     returning id, name`,
  );
  const mug = rewardRows.find((r) => r.name === 'Verification mug').id;
  const expensive = rewardRows.find((r) => r.name === 'Too expensive').id;

  const redemption = await client.query(
    `select public.redeem_reward($1, $2, 1, 'verify-redeem-1') as id`,
    [memberA, mug],
  );
  check('redemption returns an id', Boolean(redemption.rows[0].id));

  const dupRedemption = await client.query(
    `select public.redeem_reward($1, $2, 1, 'verify-redeem-1') as id`,
    [memberA, mug],
  );
  check('redemption is idempotent by key', dupRedemption.rows[0].id === redemption.rows[0].id);

  const afterRedeem = await client.query(
    `select points from public.member_balances where member_id = $1`,
    [memberA],
  );
  check('redemption debits points', afterRedeem.rows[0].points === 60);

  const stock = await client.query(`select inventory from public.rewards where id = $1`, [mug]);
  check('redemption decrements inventory', stock.rows[0].inventory === 0);

  await expectError(
    'out-of-stock redemption fails',
    `select public.redeem_reward($1, $2, 1, 'verify-redeem-2')`,
    [memberA, mug],
    'out_of_stock',
  );
  await expectError(
    'insufficient points redemption fails',
    `select public.redeem_reward($1, $2, 1, 'verify-redeem-3')`,
    [memberA, expensive],
    'insufficient_points',
  );

  // ---- Attendance ----------------------------------------------------------
  const { rows: eventRows } = await client.query(
    `insert into public.events (name, slug, summary, location, starts_at, ends_at, status)
     values ('Verify Event', 'verify-event', 'Test event', 'PSU', now() - interval '2 hours', now() + interval '2 hours', 'published')
     returning id`,
  );
  const eventId = eventRows[0].id;
  const { rows: sessionRows } = await client.query(
    `insert into public.event_sessions (
       event_id, name, kind, starts_at, ends_at, check_in_opens_at, check_in_closes_at,
       check_out_opens_at, check_out_closes_at, minimum_duration_minutes, reward_points
     ) values (
       $1, 'Main session', 'main', now() - interval '2 hours', now() + interval '2 hours',
       now() - interval '2 hours', now() + interval '1 hour',
       now() - interval '2 hours', now() + interval '2 hours', 30, 25
     ) returning id`,
    [eventId],
  );
  const sessionId = sessionRows[0].id;

  const { rows: deviceRows } = await client.query(
    `insert into public.devices (device_id, lane_label, secret_hash, mode) values ('verify-lane', 'Verify lane', 'hash', 'kiosk') returning id`,
  );
  const deviceId = deviceRows[0].id;

  async function createScan(memberId, key) {
    const { rows } = await client.query(
      `insert into public.device_scans (device_id, member_id, session_id, idempotency_key, action, status)
       values ($1, $2, $3, $4, 'check_in', 'pending') returning id`,
      [deviceId, memberId, sessionId, key],
    );
    return rows[0].id;
  }

  const scanA1 = await createScan(memberA, 'verify-scan-a1');
  const attendanceA = await client.query(`select public.confirm_scan($1, 'check_in', $2) as id`, [
    scanA1,
    adminId,
  ]);
  const attendanceId = attendanceA.rows[0].id;
  check('confirmed scan creates attendance', Boolean(attendanceId));

  await expectError(
    'duplicate check-in is rejected',
    `select public.confirm_scan($1, 'check_in', $2)`,
    [await createScan(memberA, 'verify-scan-a-dup'), adminId],
    'duplicate_check_in',
  );

  await client.query(
    `update public.attendance_records set checked_in_at = now() - interval '45 minutes' where id = $1`,
    [attendanceId],
  );
  const scanA2 = await createScan(memberA, 'verify-scan-a2');
  await client.query(`select public.confirm_scan($1, 'check_out', $2)`, [scanA2, adminId]);

  const completed = await client.query(
    `select a.qualified, a.reward_points, a.duration_minutes, a.ledger_id, a.state
     from public.attendance_records a where a.id = $1`,
    [attendanceId],
  );
  check('checkout completes attendance', completed.rows[0].state === 'completed');
  check('duration threshold met qualifies', completed.rows[0].qualified === true);
  check('reward snapshot stored', completed.rows[0].reward_points === 25);
  check(
    'duration computed in minutes',
    completed.rows[0].duration_minutes >= 44 && completed.rows[0].duration_minutes <= 46,
    `duration=${completed.rows[0].duration_minutes}`,
  );

  const afterAttendance = await client.query(
    `select points, stars from public.member_balances where member_id = $1`,
    [memberA],
  );
  check(
    'attendance grants points and stars',
    afterAttendance.rows[0].points === 85 && afterAttendance.rows[0].stars === 125,
    JSON.stringify(afterAttendance.rows[0]),
  );

  // Below threshold: 5 minutes with a 30 minute minimum.
  const scanB1 = await createScan(memberB, 'verify-scan-b1');
  const attendanceB = await client.query(`select public.confirm_scan($1, 'check_in', $2) as id`, [
    scanB1,
    adminId,
  ]);
  await client.query(
    `update public.attendance_records set checked_in_at = now() - interval '5 minutes' where id = $1`,
    [attendanceB.rows[0].id],
  );
  await client.query(`select public.confirm_scan($1, 'check_out', $2)`, [
    await createScan(memberB, 'verify-scan-b2'),
    adminId,
  ]);
  const shortAttendance = await client.query(
    `select qualified, reward_points, ledger_id from public.attendance_records where id = $1`,
    [attendanceB.rows[0].id],
  );
  check('below threshold grants nothing', shortAttendance.rows[0].qualified === false);
  check('below threshold has no ledger entry', shortAttendance.rows[0].ledger_id === null);

  // No checkout: no points. A bonus session is used so this check-in is not a
  // duplicate of the completed main-session attendance above.
  const { rows: bonusRows } = await client.query(
    `insert into public.event_sessions (
       event_id, name, kind, starts_at, ends_at, check_in_opens_at, check_in_closes_at,
       check_out_opens_at, check_out_closes_at, minimum_duration_minutes, reward_points
     ) values (
       $1, 'Bonus session', 'bonus', now() - interval '1 hour', now() + interval '1 hour',
       now() - interval '1 hour', now() + interval '30 minutes',
       now() - interval '1 hour', now() + interval '1 hour', 10, 15
     ) returning id`,
    [eventId],
  );
  const bonusSession = bonusRows[0].id;
  const { rows: scanB3Rows } = await client.query(
    `insert into public.device_scans (device_id, member_id, session_id, idempotency_key, status)
     values ($1, $2, $3, 'verify-scan-b3', 'pending') returning id`,
    [deviceId, memberB, bonusSession],
  );
  await client.query(`select public.confirm_scan($1, 'check_in', $2)`, [scanB3Rows[0].id, adminId]);
  const balanceB = await client.query(
    `select points from public.member_balances where member_id = $1`,
    [memberB],
  );
  check('missing checkout grants zero points', balanceB.rows[0].points === 0);

  const bonusCheck = await client.query(
    `select count(*)::int as n from public.attendance_records where session_id = $1 and member_id = $2 and qualified = true`,
    [bonusSession, memberB],
  );
  check('bonus attendance is independent of main session', bonusCheck.rows[0].n === 0);

  // Reversal
  const beforeReverse = await client.query(
    `select points, stars from public.member_balances where member_id = $1`,
    [memberA],
  );
  await client.query(`select public.reverse_grant($1, $2, 'Verification reversal')`, [
    completed.rows[0].ledger_id,
    adminId,
  ]);
  const afterReverse = await client.query(
    `select points, stars from public.member_balances where member_id = $1`,
    [memberA],
  );
  check(
    'reversal removes points',
    afterReverse.rows[0].points === beforeReverse.rows[0].points - 25,
  );
  check(
    'reversal removes mirrored stars',
    afterReverse.rows[0].stars === beforeReverse.rows[0].stars - 25,
  );

  // ---- Attendance corrections ----------------------------------------------
  // A source key can only be spent once, so a re-grant after a reversal needs a
  // new key or it silently awards nothing.
  const balanceOf = async (memberId) =>
    (
      await client.query(`select points, stars from public.member_balances where member_id = $1`, [
        memberId,
      ])
    ).rows[0];
  const correct = (action) =>
    client.query(`select public.correct_attendance($1, $2, null, 'Verification correction', $3)`, [
      attendanceId,
      action,
      adminId,
    ]);

  await correct('disqualify');
  const afterDisqualify = await balanceOf(memberA);
  check(
    're-disqualifying an already reversed grant changes nothing',
    afterDisqualify.points === afterReverse.rows[0].points,
    JSON.stringify(afterDisqualify),
  );

  await correct('qualify');
  const afterQualify = await balanceOf(memberA);
  check(
    're-qualifying after a reversal grants points and stars again',
    afterQualify.points === afterDisqualify.points + 25 &&
      afterQualify.stars === afterDisqualify.stars + 25,
    JSON.stringify(afterQualify),
  );
  const requalified = await client.query(
    `select qualified, reward_points, ledger_id from public.attendance_records where id = $1`,
    [attendanceId],
  );
  check(
    're-qualified attendance links its new ledger entry',
    requalified.rows[0].qualified === true &&
      requalified.rows[0].ledger_id !== completed.rows[0].ledger_id,
  );

  await correct('disqualify');
  check(
    'second disqualification reverses the new grant',
    (await balanceOf(memberA)).points === afterDisqualify.points,
  );
  await correct('qualify');
  check(
    'second re-qualification grants again',
    (await balanceOf(memberA)).points === afterDisqualify.points + 25,
  );

  await expectError(
    'check-out before check-in is rejected',
    `select public.correct_attendance($1, 'set_checkout', now() - interval '10 years', 'Verification correction', $2)`,
    [attendanceId, adminId],
    'checkout_before_check_in',
  );

  // ---- Confirmation re-checks state that changed after the preview ---------
  const staleScan = await createScan(memberB, 'verify-scan-stale');
  await client.query(`update public.members set status = 'suspended' where id = $1`, [memberB]);
  await expectError(
    'a member suspended after the preview cannot be confirmed',
    `select public.confirm_scan($1, 'check_out', $2)`,
    [staleScan, adminId],
    'member_not_active',
  );
  await client.query(`select public.confirm_scan($1, 'reject', $2)`, [staleScan, adminId]);
  const dismissed = await client.query(`select status from public.device_scans where id = $1`, [
    staleScan,
  ]);
  check('a stale scan can still be dismissed', dismissed.rows[0].status === 'rejected');
  await client.query(`update public.members set status = 'active' where id = $1`, [memberB]);

  await expectError(
    'append-only ledger blocks updates',
    `update public.point_ledger set delta = 999 where id = $1`,
    [grantId],
    'append_only_relation',
  );

  // ---- Card lifecycle ------------------------------------------------------
  const card = await client.query(
    `select public.prepare_card($1, 'verify-card-hash-1', 'cipher', $2) as id`,
    [memberA, adminId],
  );
  const cardId = card.rows[0].id;
  await client.query(`select public.activate_card($1, $2)`, [cardId, adminId]);
  const activeCard = await client.query(
    `select status, issued_at from public.card_credentials where id = $1`,
    [cardId],
  );
  check('card activates and records issue time', activeCard.rows[0].status === 'active');

  const cardStatus = async (id) =>
    (
      await client.query(`select status, revoked_at from public.card_credentials where id = $1`, [
        id,
      ])
    ).rows[0];

  const abandoned = await client.query(
    `select public.prepare_card($1, 'verify-card-hash-2', 'cipher2', $2) as id`,
    [memberA, adminId],
  );
  check(
    'preparing a replacement leaves the working card active',
    (await cardStatus(cardId)).status === 'active',
  );

  const replacement = await client.query(
    `select public.prepare_card($1, 'verify-card-hash-3', 'cipher3', $2) as id`,
    [memberA, adminId],
  );
  check(
    'a newer preparation supersedes an unwritten card',
    (await cardStatus(abandoned.rows[0].id)).status === 'replaced',
  );

  await client.query(`select public.activate_card($1, $2)`, [replacement.rows[0].id, adminId]);
  const oldCard = await cardStatus(cardId);
  check('activating the replacement revokes the previous card', oldCard.status === 'replaced');
  check('revoked card has revoked_at', oldCard.revoked_at !== null);
  check(
    'the replacement is the active card',
    (await cardStatus(replacement.rows[0].id)).status === 'active',
  );

  await client.query(`select public.revoke_card($1, $2, 'Verification loss')`, [
    replacement.rows[0].id,
    adminId,
  ]);
  const scanCard = await client.query(
    `select public.prepare_card($1, 'verify-card-hash-4', 'cipher4', $2) as id`,
    [memberB, adminId],
  );
  await client.query(`select public.activate_card($1, $2)`, [scanCard.rows[0].id, adminId]);
  const { rows: cardScanRows } = await client.query(
    `insert into public.device_scans (member_id, card_id, session_id, idempotency_key, status)
     values ($1, $2, $3, 'usb:verify-revoked-card', 'pending') returning id`,
    [memberB, scanCard.rows[0].id, bonusSession],
  );
  await client.query(`select public.revoke_card($1, $2, 'Verification loss')`, [
    scanCard.rows[0].id,
    adminId,
  ]);
  await expectError(
    'a card revoked after the preview cannot be confirmed',
    `select public.confirm_scan($1, 'check_out', $2)`,
    [cardScanRows[0].id, adminId],
    'card_not_active',
  );

  // ---- User types ----------------------------------------------------------
  const { rows: staffRows } = await client.query(`
    insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, email_change_confirm_status)
    values
      ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'verify.super@example.test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, 0),
      ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'verify.invitee@example.test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, 0),
      ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'verify.other@example.test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, 0)
    returning id, email
  `);
  const superId = staffRows.find((u) => u.email === 'verify.super@example.test').id;
  const inviteeId = staffRows.find((u) => u.email === 'verify.invitee@example.test').id;
  const otherId = staffRows.find((u) => u.email === 'verify.other@example.test').id;
  await client.query(
    `insert into public.user_roles (auth_user_id, role) values ($1, 'superadmin')`,
    [superId],
  );
  await client.query(`select public.set_user_type($1, 'superadmin', $1)`, [superId]);
  const keptSuper = await client.query(
    `select revoked_at from public.user_roles where auth_user_id = $1 and role = 'superadmin'`,
    [superId],
  );
  check('re-saving a superadmin keeps the role', keptSuper.rows[0].revoked_at === null);

  await expectError(
    'revoking every superadmin is refused',
    `update public.user_roles set revoked_at = now() where role = 'superadmin' and revoked_at is null`,
    [],
    'last_superadmin',
  );
  await expectError(
    'deleting every superadmin is refused',
    `delete from public.user_roles where role = 'superadmin'`,
    [],
    'last_superadmin',
  );

  await expectError(
    'staff cannot complete member setup',
    `select public.complete_member_setup($1, 'verify.super@example.test', 'Verify Staff', 'verify-profile-slug-staffxxx', 'member/s.webp', 'GDG-VRFS01', '', '[]'::jsonb)`,
    [superId],
    'user_is_staff',
  );

  await client.query(
    `insert into public.member_invitations (email, paid_since, auth_user_id)
     values ('verify.invitee@example.test', current_date, $1)`,
    [inviteeId],
  );
  await expectError(
    'an invitation cannot be used from a different account',
    `select public.complete_member_setup($1, 'verify.invitee@example.test', 'Verify Other', 'verify-profile-slug-otherxxx', 'member/o.webp', 'GDG-VRFO01', '', '[]'::jsonb)`,
    [otherId],
    'invitation_not_found',
  );

  // ---- RLS -----------------------------------------------------------------
  const ownLedger = await asUser(memberAId, async () => {
    const res = await client.query(`select count(*)::int as n from public.point_ledger`);
    return res.rows[0].n;
  });
  check('RLS: member reads only own ledger', ownLedger > 0 && ownLedger < 10, `rows=${ownLedger}`);

  const otherLedger = await asUser(memberAId, async () => {
    const res = await client.query(
      `select count(*)::int as n from public.point_ledger where member_id = $1`,
      [memberB],
    );
    return res.rows[0].n;
  });
  check('RLS: member cannot read another member ledger', otherLedger === 0);

  const otherProfile = await asUser(memberAId, async () => {
    const res = await client.query(
      `select count(*)::int as n from public.member_profiles where member_id = $1`,
      [memberB],
    );
    return res.rows[0].n;
  });
  check('RLS: member cannot read another profile row', otherProfile === 0);

  const adminWithoutMfa = await asUser(adminId, async () => {
    const res = await client.query(`select count(*)::int as n from public.member_profiles`);
    return res.rows[0].n;
  });
  check('RLS: admin without MFA cannot read private profiles', adminWithoutMfa === 0);
  const adminSeesAll = await asUser(
    adminId,
    async () => {
      const res = await client.query(`select count(*)::int as n from public.member_profiles`);
      return res.rows[0].n;
    },
    'aal2',
  );
  check('RLS: admin with MFA reads all profiles', adminSeesAll >= 2);

  // The projections are read with the server-only client, as the app does.
  const publicView = (await client.query(`select slug from public.public_profiles`)).rows.map(
    (r) => r.slug,
  );
  check(
    'public projection includes public profile',
    publicView.includes('verify-profile-slug-aaaaaaaa'),
  );
  check(
    'public projection hides private profile',
    !publicView.includes('verify-profile-slug-bbbbbbbb'),
  );

  const visibleEmail = await client.query(
    `select email, photo_path from public.public_profiles where slug = 'verify-profile-slug-aaaaaaaa'`,
  );
  check('email defaults public', visibleEmail.rows[0].email === 'verify.a@example.test');
  check(
    'public projection never exposes storage paths or auth IDs',
    visibleEmail.rows[0].photo_path === 'verify-profile-slug-aaaaaaaa',
  );
  await client.query('update public.member_profiles set show_email = false where member_id = $1', [
    memberA,
  ]);
  const hiddenEmail = await client.query(
    `select email from public.public_profiles where slug = 'verify-profile-slug-aaaaaaaa'`,
  );
  check(
    'email visibility is enforced in the public projection',
    hiddenEmail.rows[0].email === null,
  );
  const bucket = await client.query(`select public from storage.buckets where id = 'avatars'`);
  check('avatar bucket is private', bucket.rows[0]?.public === false);

  // ---- Organizer profiles ---------------------------------------------------
  const organizer = await client.query(
    `select public.complete_staff_profile($1, 'verify-organizer-slug-cccccc', 'GDG-VRFC03', 'Verify Organizer', null, '', false) as id`,
    [adminId],
  );
  const organizerId = organizer.rows[0].id;
  // Even with every switch on, an organizer shows no member numbers.
  await client.query(
    `update public.member_profiles
     set show_points = true, show_stars = true, show_events = true, show_on_leaderboard = true,
         show_member_number = true, show_member_since = true
     where member_id = $1`,
    [organizerId],
  );
  const organizerView = await client.query(
    `select kind, photo_path, member_number, member_since, points, stars, attended_events
     from public.public_profiles where slug = 'verify-organizer-slug-cccccc'`,
  );
  const shown = organizerView.rows[0] ?? {};
  check(
    'an organizer has a public profile with no member numbers on it',
    shown.kind === 'organizer' &&
      shown.photo_path === null &&
      shown.member_number === null &&
      shown.member_since === null &&
      shown.points === null &&
      shown.stars === null &&
      shown.attended_events === null,
  );
  const board = await client.query(`select slug from public.leaderboard`);
  check(
    'organizers never appear on the leaderboard',
    !board.rows.some((row) => row.slug === 'verify-organizer-slug-cccccc'),
  );

  let organizerPointsBlocked = false;
  await client.query('savepoint organizer_points');
  try {
    await client.query(
      `select public.grant_points($1, 5, 'interaction_reward', 'verify:organizer', 'Not allowed', $2)`,
      [organizerId, adminId],
    );
  } catch (error) {
    organizerPointsBlocked = /organizer_has_no_member_activity/.test(error.message);
  }
  await client.query('rollback to savepoint organizer_points');
  check('an organizer can never be given points', organizerPointsBlocked);

  let memberPhotoRequired = false;
  await client.query('savepoint member_photo');
  try {
    await client.query('update public.member_profiles set photo_path = null where member_id = $1', [
      memberA,
    ]);
  } catch (error) {
    memberPhotoRequired = /photo_required/.test(error.message);
  }
  await client.query('rollback to savepoint member_photo');
  check('a member profile cannot lose its photo', memberPhotoRequired);

  await client.query('savepoint promote_member');
  const promoted = await client.query(`select public.set_user_type($1, 'admin', $2) as result`, [
    memberAId,
    adminId,
  ]);
  const afterPromotion = await client.query(
    `select (select kind from public.members where id = $1) as kind,
            (select count(*)::int from public.member_profiles where member_id = $1) as profile,
            (select count(*)::int from public.point_ledger where member_id = $1) as ledger,
            (select count(*)::int from public.star_ledger where member_id = $1) as stars`,
    [memberA],
  );
  check(
    'promoting a member keeps their profile and removes their points',
    promoted.rows[0].result.history_removed === true &&
      afterPromotion.rows[0].kind === 'organizer' &&
      afterPromotion.rows[0].profile === 1 &&
      afterPromotion.rows[0].ledger === 0 &&
      afterPromotion.rows[0].stars === 0,
  );
  // With a photo on file, the same profile becomes a member's again.
  const demoted = await client.query(`select public.set_user_type($1, 'member', $2) as result`, [
    memberAId,
    adminId,
  ]);
  const afterDemotion = await client.query(`select kind from public.members where id = $1`, [
    memberA,
  ]);
  check(
    'demoting staff with a photo turns their profile back into a member profile',
    demoted.rows[0].result.member_id === memberA &&
      demoted.rows[0].result.invitation_id === null &&
      afterDemotion.rows[0].kind === 'member',
  );
  await client.query('rollback to savepoint promote_member');

  await client.query('savepoint demote_placeholder');
  const placeholder = await client.query(
    `select public.set_user_type($1, 'member', $1) as result`,
    [adminId],
  );
  const afterPlaceholder = await client.query(
    `select count(*)::int as n from public.members where id = $1`,
    [organizerId],
  );
  check(
    'demoting staff without a photo sends them through member setup',
    placeholder.rows[0].result.profile_removed === true &&
      placeholder.rows[0].result.invitation_id !== null &&
      afterPlaceholder.rows[0].n === 0,
  );
  await client.query('rollback to savepoint demote_placeholder');

  await client.query('savepoint anon_ctx');
  await client.query('set local role anon');
  let anonLedgerDenied = false;
  try {
    await client.query('select * from public.point_ledger limit 1');
  } catch (error) {
    anonLedgerDenied = /permission denied|does not exist/i.test(error.message);
    await client.query('rollback to savepoint anon_ctx');
  }
  await client.query('reset role');
  await client.query('release savepoint anon_ctx');
  check('RLS: anonymous cannot read the ledger', anonLedgerDenied);

  // ---- Identity isolation --------------------------------------------------
  const crossMember = await asUser(memberAId, async () => {
    const res = await client.query(`select public.current_member_id() as id`);
    return res.rows[0].id;
  });
  check('RLS: current_member_id resolves the signed-in member', crossMember === memberA);

  // ---- One-time sign-in links (migration 0020) -------------------------------
  // The app decides how long a link works; the database caps it, lets it be
  // used once, and keeps only one per person.
  const linkHash = (seed) => seed.repeat(64);
  await expectError(
    'a link cannot be made to last longer than 72 hours',
    `select public.issue_sign_in_link($1, 'member_invite', $2, 73, $3)`,
    [linkHash('a'), memberAId, adminId],
    'link_lifetime_out_of_range',
  );
  await client.query(`select public.issue_sign_in_link($1, 'member_invite', $2, 72, $3)`, [
    linkHash('b'),
    memberAId,
    adminId,
  ]);
  const inviteLifetime = await client.query(
    `select extract(epoch from (expires_at - created_at)) / 3600 as hours
     from public.sign_in_links where token_hash = $1`,
    [linkHash('b')],
  );
  check('an invitation link lasts 72 hours', Number(inviteLifetime.rows[0].hours) === 72);

  await client.query(`select public.issue_sign_in_link($1, 'recovery', $2, 48, $3)`, [
    linkHash('c'),
    memberAId,
    adminId,
  ]);
  const resetLifetime = await client.query(
    `select extract(epoch from (expires_at - created_at)) / 3600 as hours
     from public.sign_in_links where token_hash = $1`,
    [linkHash('c')],
  );
  check('a password reset link lasts 48 hours', Number(resetLifetime.rows[0].hours) === 48);

  const redeem = async (seed) =>
    (await client.query(`select * from public.redeem_sign_in_link($1)`, [linkHash(seed)])).rows;
  check("a new link replaces the person's earlier one", (await redeem('b')).length === 0);
  const redeemed = await redeem('c');
  check(
    'a link is redeemed for the person and purpose it was made for',
    redeemed.length === 1 &&
      redeemed[0].auth_user_id === memberAId &&
      redeemed[0].purpose === 'recovery',
  );
  check('a link works once', (await redeem('c')).length === 0);

  await client.query(`select public.issue_sign_in_link($1, 'recovery', $2, 48, $3)`, [
    linkHash('d'),
    memberAId,
    adminId,
  ]);
  await client.query(
    `update public.sign_in_links
     set created_at = now() - interval '49 hours', expires_at = now() - interval '1 hour'
     where token_hash = $1`,
    [linkHash('d')],
  );
  check('a link past its time is refused', (await redeem('d')).length === 0);
  await expectError(
    'the table refuses a lifetime over 72 hours',
    `update public.sign_in_links set expires_at = created_at + interval '73 hours' where token_hash = $1`,
    [linkHash('d')],
    'check constraint',
  );
  await expectDenied(
    'anon cannot read sign-in links',
    'anon',
    'select token_hash from public.sign_in_links',
  );
  await expectDenied(
    'members cannot read sign-in links',
    'authenticated',
    'select token_hash from public.sign_in_links',
  );
  const invitationDefault = await client.query(
    `select column_default from information_schema.columns
     where table_schema = 'public' and table_name = 'member_invitations' and column_name = 'expires_at'`,
  );
  check(
    'a new invitation is open for 72 hours unless told otherwise',
    /72:00:00|72 hours/.test(invitationDefault.rows[0].column_default),
    invitationDefault.rows[0].column_default,
  );

  // ---- Permanent delete (migration 0019) ------------------------------------
  // Only a superadmin deletes, every delete is recorded, points and stars stay,
  // and nothing can delete the record of it.
  await expectError(
    'only a superadmin can delete for good',
    `select public.delete_record('event', $1, $2)`,
    [eventId, adminId],
    'superadmin_required',
  );
  await expectError(
    'the audit log is not a kind of record that can be deleted',
    `select public.delete_record('audit_log', $1, $2)`,
    [eventId, superId],
    'unknown_kind',
  );
  await expectError(
    'a superadmin cannot delete their own account',
    `select public.delete_record('user', $1, $1)`,
    [superId],
    'cannot_delete_self',
  );

  await client.query(`select set_config('app.member_erasure', 'on', true)`);
  await expectError(
    'audit entries cannot be deleted, even during an erasure',
    `delete from public.audit_log`,
    [],
    'audit_log_is_permanent',
  );
  await expectError(
    'audit entries cannot be changed, even during an erasure',
    `update public.audit_log set reason = 'rewritten'`,
    [],
    'audit_log_is_permanent',
  );
  await client.query(`select set_config('app.member_erasure', 'off', true)`);

  const deleteCounts = async () =>
    (
      await client.query(
        `select (select count(*)::int from public.point_ledger) as ledger,
                (select count(*)::int from public.star_ledger) as stars,
                (select count(*)::int from public.audit_log) as audit,
                (select points from public.member_balances where member_id = $1) as points`,
        [memberA],
      )
    ).rows[0];

  // An attendance that gave points must be corrected first, not deleted.
  const { rows: attendanceKinds } = await client.query(
    `select (select id from public.attendance_records where qualified limit 1) as qualified,
            (select id from public.attendance_records where not qualified limit 1) as plain`,
  );
  await expectError(
    'an attendance that gave points cannot be deleted',
    `select public.delete_record('attendance', $1, $2)`,
    [attendanceKinds[0].qualified, superId],
    'attendance_has_points',
  );
  let before = await deleteCounts();
  await client.query(`select public.delete_record('attendance', $1, $2)`, [
    attendanceKinds[0].plain,
    superId,
  ]);
  let after = await deleteCounts();
  const attendanceGone = await client.query(
    `select (select count(*)::int from public.attendance_records where id = $1) as record,
            (select count(*)::int from public.attendance_audit_events where attendance_id = $1) as trail`,
    [attendanceKinds[0].plain],
  );
  check(
    'deleting an attendance removes it and its trail, and is recorded',
    Boolean(attendanceKinds[0].plain) &&
      attendanceGone.rows[0].record === 0 &&
      attendanceGone.rows[0].trail === 0 &&
      after.audit === before.audit + 1 &&
      after.ledger === before.ledger,
  );

  // A reward: waiting requests are decided first; handled ones go with it.
  await client.query(
    `select public.grant_points($1, 50, 'admin_adjustment', 'verify:delete:points', 'Delete setup')`,
    [memberA],
  );
  const { rows: doomedReward } = await client.query(
    `insert into public.rewards (name, description, cost_points) values ('Delete me', 'Test reward', 5)
     returning id`,
  );
  const doomedRequest = await client.query(
    `select public.redeem_reward($1, $2, 1, 'verify-delete-1') as id`,
    [memberA, doomedReward[0].id],
  );
  await expectError(
    'a reward with a waiting request cannot be deleted',
    `select public.delete_record('reward', $1, $2)`,
    [doomedReward[0].id, superId],
    'reward_has_open_requests',
  );
  await expectError(
    'a waiting request cannot be deleted',
    `select public.delete_record('redemption', $1, $2)`,
    [doomedRequest.rows[0].id, superId],
    'redemption_still_open',
  );
  await client.query(`select public.decide_redemption($1, 'approve', $2, null)`, [
    doomedRequest.rows[0].id,
    superId,
  ]);
  await client.query(`select public.decide_redemption($1, 'fulfil', $2, null)`, [
    doomedRequest.rows[0].id,
    superId,
  ]);
  before = await deleteCounts();
  const deletedReward = await client.query(
    `select public.delete_record('reward', $1, $2) as before`,
    [doomedReward[0].id, superId],
  );
  after = await deleteCounts();
  const rewardGone = await client.query(
    `select (select count(*)::int from public.rewards where id = $1) as reward,
            (select count(*)::int from public.redemptions where reward_id = $1) as requests`,
    [doomedReward[0].id],
  );
  check(
    'deleting a reward removes it and its handled requests',
    rewardGone.rows[0].reward === 0 &&
      rewardGone.rows[0].requests === 0 &&
      deletedReward.rows[0].before.name === 'Delete me',
  );
  check(
    'deleting a reward leaves the points spent on it spent',
    after.ledger === before.ledger && after.points === before.points,
    `points ${before.points} -> ${after.points}`,
  );

  // A card.
  const { rows: doomedCard } = await client.query(
    `select id, member_id from public.card_credentials order by created_at desc limit 1`,
  );
  await client.query(`select public.delete_record('card', $1, $2)`, [doomedCard[0].id, superId]);
  const cardGone = await client.query(
    `select (select count(*)::int from public.card_credentials where id = $1) as card,
            (select count(*)::int from public.audit_log
              where action = 'card.deleted' and target_type = 'member' and target_id = $2) as recorded`,
    [doomedCard[0].id, doomedCard[0].member_id],
  );
  check(
    'deleting a card removes it and records whose it was',
    cardGone.rows[0].card === 0 && cardGone.rows[0].recorded === 1,
  );

  // An event: sessions and attendance go, what was earned stays.
  const linkedBefore = await client.query(
    `select count(*)::int as n from public.point_ledger where event_id = $1`,
    [eventId],
  );
  before = await deleteCounts();
  const deletedEvent = await client.query(
    `select public.delete_record('event', $1, $2) as before`,
    [eventId, superId],
  );
  after = await deleteCounts();
  const eventGone = await client.query(
    `select (select count(*)::int from public.events where id = $1) as events,
            (select count(*)::int from public.event_sessions where event_id = $1) as sessions,
            (select count(*)::int from public.attendance_records where session_id = $2) as attendance,
            (select count(*)::int from public.audit_log
              where action = 'event.deleted' and target_id = $3 and actor_auth_id = $4) as recorded`,
    [eventId, sessionId, String(eventId), superId],
  );
  check(
    'deleting an event removes its sessions and attendance',
    eventGone.rows[0].events === 0 &&
      eventGone.rows[0].sessions === 0 &&
      eventGone.rows[0].attendance === 0,
  );
  check(
    'deleting an event keeps the points and stars it gave',
    linkedBefore.rows[0].n > 0 &&
      after.ledger === before.ledger &&
      after.stars === before.stars &&
      after.points === before.points,
    `linked=${linkedBefore.rows[0].n} points ${before.points} -> ${after.points}`,
  );
  check(
    'a delete adds one audit entry that names what was deleted',
    after.audit === before.audit + 1 &&
      eventGone.rows[0].recorded === 1 &&
      deletedEvent.rows[0].before.name === 'Verify Event',
  );
  await expectError(
    'deleting something twice says it is gone',
    `select public.delete_record('event', $1, $2)`,
    [eventId, superId],
    'not_found',
  );

  // An invitation: the unused account goes with it, a real person's does not.
  const { rows: doomedInvitee } = await client.query(`
    insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, email_change_confirm_status)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      'verify.delete.invitee@example.test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, 0)
    returning id
  `);
  const { rows: doomedInvites } = await client.query(
    `insert into public.member_invitations (email, paid_since, auth_user_id, status) values
       ('verify.delete.invitee@example.test', current_date, $1, 'pending'),
       ('verify.b@example.test', current_date, $2, 'revoked')
     returning id, email`,
    [doomedInvitee[0].id, memberBId],
  );
  for (const invite of doomedInvites) {
    await client.query(`select public.delete_record('invitation', $1, $2)`, [invite.id, superId]);
  }
  const inviteGone = await client.query(
    `select (select count(*)::int from public.member_invitations where id = any($1::uuid[])) as invites,
            (select count(*)::int from auth.users where id = $2) as unused_account,
            (select count(*)::int from auth.users where id = $3) as member_account`,
    [doomedInvites.map((invite) => invite.id), doomedInvitee[0].id, memberBId],
  );
  check(
    'deleting an unused invitation removes the account made for it',
    inviteGone.rows[0].invites === 0 && inviteGone.rows[0].unused_account === 0,
  );
  check(
    'deleting an invitation never removes a member account',
    inviteGone.rows[0].member_account === 1,
  );

  // A person: everything about them goes, and the entry does not name them.
  before = await deleteCounts();
  const deletedUser = await client.query(`select public.delete_record('user', $1, $2) as before`, [
    memberBId,
    superId,
  ]);
  after = await deleteCounts();
  const userGone = await client.query(
    `select (select count(*)::int from auth.users where id = $1) as account,
            (select count(*)::int from public.members where id = $2) as member,
            (select count(*)::int from public.member_profiles where member_id = $2) as profile,
            (select count(*)::int from public.member_private where member_id = $2) as private,
            (select count(*)::int from public.point_ledger where member_id = $2) as ledger`,
    [memberBId, memberB],
  );
  check(
    'deleting an account removes the person and everything about them',
    Object.values(userGone.rows[0]).every((count) => count === 0),
    JSON.stringify(userGone.rows[0]),
  );
  check(
    'the record of a deleted account does not name them',
    after.audit === before.audit + 1 &&
      JSON.stringify(deletedUser.rows[0].before) === JSON.stringify({ kind: 'member', roles: [] }),
    JSON.stringify(deletedUser.rows[0].before),
  );

  await client.query('rollback');

  // ---- True concurrency (separate committed transactions) ------------------
  const concurrency = new Client({ connectionString: env.DATABASE_URL, ssl });
  const racer = new Client({ connectionString: env.DATABASE_URL, ssl });
  await concurrency.connect();
  await racer.connect();
  let raceUserId = null;
  let raceRewardId = null;
  let eraseAuthId = null;
  let eraseMemberId = null;
  const superAuthIds = [];
  try {
    const { rows: raceUser } = await concurrency.query(
      `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at,
         raw_app_meta_data, raw_user_meta_data, email_change_confirm_status)
       values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now(), now(),
         '{}'::jsonb, '{}'::jsonb, 0)
       returning id`,
      [`verify.race.${Date.now()}@example.test`],
    );
    raceUserId = raceUser[0].id;
    const { rows: raceMember } = await concurrency.query(
      `insert into public.members (auth_user_id, public_number, member_since)
       values ($1, $2, current_date) returning id`,
      [raceUserId, `GDG-R${String(Date.now()).slice(-5)}`],
    );
    const memberId = raceMember[0].id;
    await concurrency.query(
      `select public.grant_points($1, 100, 'admin_adjustment', $2, 'Race setup')`,
      [memberId, `verify:race:${raceUserId}`],
    );
    const { rows: raceReward } = await concurrency.query(
      `insert into public.rewards (name, cost_points, inventory) values ('Race reward', 100, 5) returning id`,
    );
    raceRewardId = raceReward[0].id;

    await concurrency.query('begin');
    await concurrency.query(`select public.redeem_reward($1, $2, 1, 'verify-race-first')`, [
      memberId,
      raceRewardId,
    ]);

    await racer.query('begin');
    const racerResult = racer
      .query(`select public.redeem_reward($1, $2, 1, 'verify-race-second')`, [
        memberId,
        raceRewardId,
      ])
      .then(() => 'success')
      .catch((error) => error.message);

    await concurrency.query('commit');
    const secondResult = await racerResult;
    await racer.query('rollback').catch(() => {});

    check(
      'concurrent overspend is rejected by the transaction lock',
      String(secondResult).includes('insufficient_points'),
      String(secondResult),
    );

    const { rows: finalBalance } = await racer.query(
      `select points from public.member_balances where member_id = $1`,
      [memberId],
    );
    check('balance never goes negative', finalBalance[0].points === 0);

    // A double-submitted redemption must return the same request, not a 500.
    await concurrency.query(
      `select public.grant_points($1, 100, 'admin_adjustment', $2, 'Idempotency setup')`,
      [memberId, `verify:race-repeat:${raceUserId}`],
    );
    await concurrency.query('begin');
    const firstRedeem = await concurrency.query(
      `select public.redeem_reward($1, $2, 1, 'verify-race-repeat') as id`,
      [memberId, raceRewardId],
    );
    await racer.query('begin');
    const repeatRedeem = racer
      .query(`select public.redeem_reward($1, $2, 1, 'verify-race-repeat') as id`, [
        memberId,
        raceRewardId,
      ])
      .then((result) => result.rows[0].id)
      .catch((error) => error.message);
    await concurrency.query('commit');
    const repeatResult = await repeatRedeem;
    await racer.query('rollback').catch(() => {});
    check(
      'a concurrent repeat of a redemption key returns the same redemption',
      repeatResult === firstRedeem.rows[0].id,
      String(repeatResult),
    );

    // ---- Last superadmin under concurrency (migration 0014) ----------------
    for (const label of ['a', 'b']) {
      const { rows } = await concurrency.query(
        `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at,
           raw_app_meta_data, raw_user_meta_data, email_change_confirm_status)
         values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now(), now(),
           '{}'::jsonb, '{}'::jsonb, 0)
         returning id`,
        [`verify.super.${label}.${Date.now()}@example.test`],
      );
      superAuthIds.push(rows[0].id);
      await concurrency.query(
        `insert into public.user_roles (auth_user_id, role) values ($1, 'superadmin')`,
        [rows[0].id],
      );
    }
    const revokeSuper = `update public.user_roles set revoked_at = now()
      where auth_user_id = $1 and role = 'superadmin' and revoked_at is null`;
    await concurrency.query('begin');
    await concurrency.query(revokeSuper, [superAuthIds[0]]);
    await racer.query('begin');
    const secondRevoke = racer
      .query(revokeSuper, [superAuthIds[1]])
      .then(() => 'revoked')
      .catch((error) => error.message);
    await concurrency.query('commit');
    const secondRevokeResult = await secondRevoke;
    await racer.query(secondRevokeResult === 'revoked' ? 'commit' : 'rollback').catch(() => {});
    const { rows: superadmins } = await racer.query(
      `select count(*)::int as n from public.user_roles where role = 'superadmin' and revoked_at is null`,
    );
    check(
      'concurrent revocations cannot remove the last superadmin',
      superadmins[0].n >= 1,
      `${superadmins[0].n} left; second revoke: ${secondRevokeResult}`,
    );

    // ---- Controlled erasure (migration 0009) -------------------------------
    // Account closure must remove history even though the ledgers are
    // append-only; ordinary deletes must stay blocked afterwards.
    const { rows: eraseUser } = await concurrency.query(
      `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at,
         raw_app_meta_data, raw_user_meta_data, email_change_confirm_status)
       values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now(), now(),
         '{}'::jsonb, '{}'::jsonb, 0)
       returning id`,
      [`verify.erase.${Date.now()}@example.test`],
    );
    eraseAuthId = eraseUser[0].id;
    const { rows: eraseMember } = await concurrency.query(
      `insert into public.members (auth_user_id, public_number, member_since)
       values ($1, $2, current_date) returning id`,
      [eraseAuthId, `GDG-E${String(Date.now()).slice(-5)}`],
    );
    eraseMemberId = eraseMember[0].id;
    await concurrency.query(
      `select public.grant_points($1, 50, 'admin_adjustment', $2, 'Erasure setup')`,
      [eraseMemberId, `verify:erase:${eraseAuthId}`],
    );

    let plainDeleteBlocked = false;
    try {
      await concurrency.query(`delete from public.point_ledger where member_id = $1`, [
        eraseMemberId,
      ]);
    } catch (error) {
      plainDeleteBlocked = /append_only_relation/.test(error.message);
    }
    const ledgerIntact = await concurrency.query(
      `select count(*)::int as n from public.point_ledger where member_id = $1`,
      [eraseMemberId],
    );
    check(
      'ordinary deletes stay blocked outside erasure',
      plainDeleteBlocked && ledgerIntact.rows[0].n === 1,
    );

    const erased = await concurrency.query(`select public.erase_member($1) as id`, [eraseAuthId]);
    const erasedRows = await concurrency.query(
      `select (select count(*)::int from public.members where id = $1) as member,
              (select count(*)::int from public.point_ledger where member_id = $1) as ledger,
              (select count(*)::int from public.member_profiles where member_id = $1) as profile`,
      [eraseMemberId],
    );
    check('erasure returns the erased member id', erased.rows[0].id === eraseMemberId);
    check(
      'erasure removes the member and its ledger',
      erasedRows.rows[0].member === 0 &&
        erasedRows.rows[0].ledger === 0 &&
        erasedRows.rows[0].profile === 0,
    );
  } finally {
    for (const authId of [raceUserId, eraseAuthId, ...superAuthIds]) {
      if (!authId) continue;
      try {
        await concurrency.query(`select public.erase_member($1)`, [authId]);
      } catch (error) {
        // Already erased inside the test body.
        if (!/auth_user_not_found/.test(error.message)) {
          failures.push(`cleanup: erase_member(${authId}) failed — ${error.message}`);
        }
      }
    }
    if (raceRewardId) {
      try {
        await concurrency.query(`delete from public.rewards where id = $1`, [raceRewardId]);
      } catch (error) {
        failures.push(`cleanup: reward delete failed — ${error.message}`);
      }
    }
    await concurrency.end().catch(() => {});
    await racer.end().catch(() => {});
  }
} catch (error) {
  await client.query('rollback').catch(() => {});
  failures.push(`unexpected: ${error.message}`);
  console.error(error);
} finally {
  await client.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
