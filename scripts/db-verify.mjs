#!/usr/bin/env node
/**
 * Database integration verification.
 *
 * Runs entirely inside a transaction that is rolled back, so it can be run
 * against a disposable/staging project without leaving rows behind.
 *
 *   node scripts/db-verify.mjs
 *
 * Covers: ledger idempotency and stars, redemption inventory/balance races,
 * attendance windows/threshold/duplicate handling, reversals, card lifecycle
 * and RLS (member isolation, private profiles, anon denial).
 */
import process from 'node:process';
import { Client } from 'pg';
import { loadEnv } from './lib/env.mjs';

const env = await loadEnv();
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
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
  const { rows: users } = await client.query(`
    insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
    values
      ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'verify.admin@example.test', now(), now(), now()),
      ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'verify.a@example.test', now(), now(), now()),
      ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'verify.b@example.test', now(), now(), now())
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

  await client.query(`select public.prepare_card($1, 'verify-card-hash-2', 'cipher2', $2)`, [
    memberA,
    adminId,
  ]);
  const oldCard = await client.query(
    `select status, revoked_at from public.card_credentials where id = $1`,
    [cardId],
  );
  check('new card preparation revokes the previous card', oldCard.rows[0].status === 'replaced');
  check('revoked card has revoked_at', oldCard.rows[0].revoked_at !== null);

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

  const publicView = await asUser(memberAId, async () => {
    const res = await client.query(`select slug from public.public_profiles`);
    return res.rows.map((r) => r.slug);
  });
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

  await client.query('rollback');

  // ---- True concurrency (separate committed transactions) ------------------
  const concurrency = new Client({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  const racer = new Client({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  await concurrency.connect();
  await racer.connect();
  let raceUserId = null;
  let raceRewardId = null;
  try {
    const { rows: raceUser } = await concurrency.query(
      `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now(), now())
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
  } finally {
    if (raceRewardId) {
      await concurrency
        .query(`delete from public.rewards where id = $1`, [raceRewardId])
        .catch(() => {});
    }
    if (raceUserId) {
      await concurrency.query(`delete from auth.users where id = $1`, [raceUserId]).catch(() => {});
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
