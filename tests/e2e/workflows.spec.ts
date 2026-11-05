import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { baseUrl, hasSupabaseAdminCredentials, loadTestEnv, siteOrigin } from './support/env';
import {
  createDisposableAdmin,
  deleteAdminFixture,
  deleteMemberFixture,
  serviceClient,
} from './support/supabase';
import { totp } from './support/totp';

loadTestEnv();

// sharp is a dependency of the web app, not of the repository root.
const sharp = createRequire(path.resolve('apps/web/package.json'))('sharp');

const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const HOUR = 3_600_000;

const stamp = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const people = {
  superadmin: { email: `wf-super-${stamp}@example.com`, password: `Wf-Super-${stamp}-1a` },
  admin: { email: `wf-admin-${stamp}@example.com`, password: `Wf-Admin-${stamp}-2b` },
  member: { email: `wf-member-${stamp}@example.com`, password: `Wf-Member-${stamp}-3c` },
  second: { email: `wf-second-${stamp}@example.com`, password: `Wf-Second-${stamp}-4d` },
};

/** Event times are typed as America/New_York wall-clock values. */
function newYorkInput(at: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Decodes the Supabase session held in the (possibly chunked) auth cookies. */
function readSession(cookies: { name: string; value: string }[]) {
  const chunks = cookies
    .filter((cookie) => /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name))
    .sort((a, b) => Number(a.name.split('.')[1] ?? 0) - Number(b.name.split('.')[1] ?? 0));
  const joined = chunks.map((chunk) => chunk.value).join('');
  return JSON.parse(Buffer.from(joined.replace(/^base64-/, ''), 'base64url').toString('utf8'));
}

test.describe('every member and organizer workflow', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  const supabase = () => serviceClient();
  const browserProblems: string[] = [];
  const contexts: BrowserContext[] = [];
  const fixtureAuthIds = new Set<string>();

  let superPage: Page;
  let adminPage: Page;
  let memberPage: Page;
  let memberContext: BrowserContext;
  let anonPage: Page;
  let superSecret = '';
  let memberId = '';
  let memberAuthId = '';
  let memberSlug = '';
  const memberName = 'Workflow Member';
  let eventId = '';
  // The web address is made from the name, so the name carries the run's stamp.
  const eventName = `Workflow Event ${stamp}`;
  const eventSlug = `workflow-event-${stamp}`;
  // Invited only to be deleted again.
  const strayEmail = `wf-stray-${stamp}@example.com`;
  let mainSessionId = '';
  let bonusSessionId = '';
  let firstCardUrl = '';
  let activeCardUrl = '';
  let origin = '';

  function watch(page: Page, label: string): Page {
    page.on('pageerror', (error) => browserProblems.push(`${label}: ${error.message}`));
    page.on('console', (message) => {
      if (/^CSP violation/.test(message.text())) {
        browserProblems.push(`${label} at ${page.url()}: ${message.text()}`);
      }
    });
    void page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        // Chrome probes a preview of a fake image this way. The setup test uploads
        // one on purpose, and the block is harmless because no script is involved.
        if (event.violatedDirective === 'connect-src' && event.blockedURI === 'blob') return;
        console.error(
          `CSP violation: ${event.violatedDirective} blocked ${event.blockedURI} from ${event.sourceFile}:${event.lineNumber}:${event.columnNumber}`,
        );
      });
    });
    // Destructive buttons use window.confirm, which Playwright declines by default.
    page.on('dialog', (dialog) => void dialog.accept());
    return page;
  }

  async function newPage(browser: import('@playwright/test').Browser, label: string) {
    const context = await browser.newContext({ baseURL: origin });
    contexts.push(context);
    return watch(await context.newPage(), label);
  }

  async function signIn(page: Page, email: string, password: string) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }

  async function enrollTotp(page: Page): Promise<string> {
    await expect(page).toHaveURL(/\/admin-mfa/, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Set up authenticator' }).click();
    const code = page.locator('code');
    await expect(code).toBeVisible();
    const secret = (await code.textContent())?.trim().toUpperCase() ?? '';
    await page.getByLabel('Six-digit code').fill(totp(secret));
    await page.getByRole('button', { name: 'Verify and open admin' }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
    return secret;
  }

  async function invite(page: Page, email: string): Promise<string> {
    await page.goto('/admin/users?invite=1');
    await page.locator('#invite-email').fill(email);
    await page.locator('#invite-paid-since').fill('2026-01-15');
    await page.getByRole('button', { name: 'Make an invitation link' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Invitation link ready' })).toBeVisible(
      { timeout: 20_000 },
    );
    return page.getByLabel('One-time sign-in link').inputValue();
  }

  async function useLink(page: Page, link: string) {
    await page.goto(link);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }

  async function fillSetup(page: Page, name: string, password?: string) {
    await page.getByLabel('Display name').fill(name);
    if (password) {
      await page.locator('input[name="password"]').fill(password);
      await page.locator('input[name="confirmPassword"]').fill(password);
    }
    await page.locator('input[name="photoAttestation"]').check();
    await page.locator('input[name="acceptTerms"]').check();
  }

  async function balance(id = memberId) {
    const { data } = await supabase()
      .from('member_balances')
      .select('points, stars')
      .eq('member_id', id)
      .single();
    return data as { points: number; stars: number };
  }

  // Polls because a success message from the previous action can still be on screen.
  async function expectBalance(points: number, stars: number) {
    await expect.poll(() => balance()).toEqual({ points, stars });
  }

  /** A stand-in for the USB lane whose card contents the test controls. */
  async function installFakeReader(page: Page) {
    await page.addInitScript(() => {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const state = window as unknown as { __cardUri: string | null; __corruptWrites?: boolean };
      state.__cardUri = null;
      class FakeSerialPort {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
        private controller!: ReadableStreamDefaultController<Uint8Array>;
        constructor() {
          this.readable = new ReadableStream<Uint8Array>({
            start: (controller) => {
              this.controller = controller;
            },
          });
          this.writable = new WritableStream<Uint8Array>({
            write: (chunk) => {
              for (const line of decoder.decode(chunk).split('\n')) {
                if (!line.trim()) continue;
                const command = JSON.parse(line) as { id: number; cmd: string; uri?: string };
                let payload: Record<string, unknown>;
                if (command.cmd === 'info') {
                  payload = {
                    id: command.id,
                    ok: true,
                    result: {
                      protocol: 2,
                      firmware: 'test',
                      deviceId: 'esp32-test',
                      nfcReady: true,
                    },
                  };
                } else if (command.cmd === 'nfc.write') {
                  state.__cardUri = state.__corruptWrites
                    ? `${command.uri}#corrupt`
                    : (command.uri ?? null);
                  payload = { id: command.id, ok: true, result: { readBack: true } };
                } else if (command.cmd === 'nfc.read' && state.__cardUri?.startsWith('error:')) {
                  payload = { id: command.id, ok: false, error: state.__cardUri.slice(6) };
                } else if (command.cmd === 'nfc.read' && state.__cardUri) {
                  payload = { id: command.id, ok: true, result: { uri: state.__cardUri } };
                } else {
                  payload = { id: command.id, ok: false, error: 'no_card' };
                }
                this.controller.enqueue(encoder.encode(JSON.stringify(payload) + '\n'));
              }
            },
          });
        }
        async open() {}
        async close() {}
        getInfo() {
          return { usbVendorId: 0x10c4, usbProductId: 0xea60 };
        }
      }
      const port = new FakeSerialPort();
      Object.defineProperty(navigator, 'serial', {
        configurable: true,
        value: { requestPort: async () => port },
      });
    });
  }

  async function setCard(page: Page, uri: string | null) {
    await page.evaluate((value) => {
      (window as unknown as { __cardUri: string | null }).__cardUri = value;
    }, uri);
  }

  async function connectReader(page: Page) {
    await page.getByRole('button', { name: 'Connect reader' }).click();
    await expect(page.getByText('Waiting for a card')).toBeVisible({ timeout: 15_000 });
  }

  /** Lifts whatever is on the kiosk reader, then puts this card down. */
  async function tapCard(page: Page, uri: string) {
    await setCard(page, null);
    await expect(page.getByText('Waiting for a card')).toBeVisible({ timeout: 15_000 });
    await setCard(page, uri);
  }

  test.beforeAll(async ({ browser, baseURL }, testInfo) => {
    test.skip(!hasSupabaseAdminCredentials(), 'Needs a disposable Supabase stack.');
    test.skip(testInfo.project.name !== 'desktop-chromium', 'The workflow suite runs once.');
    origin = new URL(baseURL ?? baseUrl()).origin;
    test.skip(origin !== siteOrigin(), `Links are issued for ${siteOrigin()}.`);

    await supabase().from('rate_limit_counters').delete().neq('bucket', '');

    superPage = await newPage(browser, 'superadmin');
    adminPage = await newPage(browser, 'admin');
    memberPage = await newPage(browser, 'member');
    memberContext = memberPage.context();
    anonPage = await newPage(browser, 'anonymous');
    await installFakeReader(adminPage);
  });

  test.afterAll(async () => {
    if (!hasSupabaseAdminCredentials() || !origin) return;
    const client = supabase();
    for (const context of contexts) await context.close().catch(() => {});
    for (const email of [people.member.email, people.second.email]) {
      const { data: rows } = await client
        .from('member_invitations')
        .select('auth_user_id')
        .eq('email', email);
      for (const row of rows ?? []) {
        if (row.auth_user_id) fixtureAuthIds.add(row.auth_user_id as string);
      }
    }
    for (const id of fixtureAuthIds) {
      await deleteMemberFixture(client, id).catch((error) => {
        console.warn('Could not delete a fixture:', error);
      });
    }
    await client.from('rewards').delete().like('name', `WF ${stamp}%`);
    await client.from('events').delete().like('slug', `%${stamp}%`);
    await client
      .from('member_invitations')
      .delete()
      .in('email', [people.member.email, people.second.email, strayEmail]);
  });

  test('public signup is refused by the auth API', async ({ request }) => {
    const response = await request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' },
      data: { email: `wf-stranger-${stamp}@example.com`, password: 'Stranger-Password-1' },
    });
    expect(response.ok()).toBe(false);
    expect(JSON.stringify(await response.json())).toMatch(/signup/i);
  });

  test('the public key cannot reach privileged functions or projections', async ({ request }) => {
    const headers = { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' };
    const api = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const rpc = await request.post(`${api}/rest/v1/rpc/set_user_type`, {
      headers,
      data: {
        p_auth_user_id: '00000000-0000-0000-0000-000000000000',
        p_role: 'superadmin',
        p_actor: '00000000-0000-0000-0000-000000000000',
      },
    });
    expect([401, 403]).toContain(rpc.status());
    const view = await request.get(`${api}/rest/v1/public_profiles?select=email`, { headers });
    expect([401, 403]).toContain(view.status());
  });

  test('staff sign in, get a clear error on bad credentials, and enroll TOTP', async () => {
    const client = supabase();
    const superadmin = await createDisposableAdmin(client, {
      ...people.superadmin,
      role: 'superadmin',
    });
    const admin = await createDisposableAdmin(client, people.admin);
    fixtureAuthIds.add(superadmin.user.id);
    fixtureAuthIds.add(admin.user.id);

    await signIn(superPage, people.superadmin.email, 'not-the-right-password-1');
    await expect(superPage.getByText('Email or password is incorrect.')).toBeVisible();
    await expect(superPage.getByLabel('Email')).toHaveValue(people.superadmin.email);

    await signIn(superPage, people.superadmin.email, people.superadmin.password);
    await expect(superPage).toHaveURL(/\/admin-mfa/, { timeout: 20_000 });
    await superPage.goto('/admin');
    await expect(superPage).toHaveURL(/\/admin-mfa/);

    await superPage.getByRole('button', { name: 'Set up authenticator' }).click();
    const code = superPage.locator('code');
    await expect(code).toBeVisible();
    superSecret = (await code.textContent())?.trim().toUpperCase() ?? '';
    await superPage.getByLabel('Six-digit code').fill('000000');
    await superPage.getByRole('button', { name: 'Verify and open admin' }).click();
    await expect(superPage.getByText('That code did not work')).toBeVisible();
    await superPage.getByLabel('Six-digit code').fill(totp(superSecret));
    await superPage.getByRole('button', { name: 'Verify and open admin' }).click();
    await expect(superPage).toHaveURL(/\/admin$/, { timeout: 20_000 });

    await signIn(adminPage, people.admin.email, people.admin.password);
    await enrollTotp(adminPage);
  });

  test('session cookies are HttpOnly and SameSite=Lax', async () => {
    const cookies = await superPage.context().cookies();
    const auth = cookies.filter((cookie) => cookie.name.startsWith('sb-'));
    expect(auth.length).toBeGreaterThan(0);
    for (const cookie of auth) {
      expect(cookie.httpOnly, cookie.name).toBe(true);
      expect(cookie.sameSite, cookie.name).toBe('Lax');
    }
  });

  test('a cross-site post cannot set a session', async ({ request }) => {
    const response = await request.post('/api/auth/session', {
      headers: { origin: 'https://attacker.example' },
      data: { accessToken: 'a'.repeat(30), refreshToken: 'b'.repeat(30), next: '//evil.example' },
    });
    expect(response.status()).toBe(403);
  });

  test('normal admins cannot open superadmin pages', async () => {
    await adminPage.goto('/admin/audit');
    await expect(adminPage).toHaveURL(/\/admin\?notice=superadmin-required/);
    await adminPage.goto('/admin/users');
    await expect(adminPage.getByRole('link', { name: 'Manage' })).toHaveCount(0);
    await adminPage.goto('/admin/staff/00000000-0000-4000-8000-000000000000');
    await expect(adminPage).toHaveURL(/\/admin\?notice=superadmin-required/);
  });

  test('the admin area has five tabs, and old addresses still lead somewhere', async () => {
    const tabs = adminPage.getByRole('navigation', { name: 'Admin sections' });
    const current = tabs.locator('[aria-current="page"]');
    await adminPage.goto('/admin');
    await expect(tabs.getByRole('link')).toHaveText([
      'Home',
      'People',
      'Cards',
      'Events',
      'Rewards',
    ]);
    await expect(current).toHaveText('Home');

    await adminPage.goto('/admin/users?invite=1');
    await expect(adminPage).toHaveURL(/\/admin\/users\?invite=1$/);
    await expect(current).toHaveText('People');
    await expect(adminPage.locator('#invite-email')).toBeVisible();
    // Only a superadmin is offered the organizer invitation.
    await expect(adminPage.getByRole('heading', { name: 'Invite an organizer' })).toHaveCount(0);
    await superPage.goto('/admin/users');
    await expect(superPage.locator('#invite-email')).toBeHidden();
    await superPage.getByText('Invite someone', { exact: true }).click();
    await expect(superPage.getByRole('heading', { name: 'Invite an organizer' })).toBeVisible();

    // The kiosk belongs to Events, and a page with no tab of its own lights none.
    await adminPage.goto('/admin/kiosk');
    await expect(current).toHaveText('Events');
    await adminPage.goto('/admin/profile');
    await expect(current).toHaveCount(0);

    // The tiles on Home are links to what they count.
    await adminPage.goto('/admin');
    await expect(adminPage.getByRole('link', { name: /Reward requests waiting/ })).toHaveAttribute(
      'href',
      '/admin/rewards',
    );
    await expect(adminPage.getByRole('link', { name: 'Open kiosk' })).toBeVisible();
  });

  test('an invitation can be revoked and re-issued, and only its creator sees it', async ({
    request,
  }) => {
    const firstLink = await invite(adminPage, people.member.email);
    expect(new URL(firstLink).origin).toBe(origin);

    await adminPage.goto('/admin/users?invite=1');
    await adminPage.locator('#invite-email').fill(people.member.email);
    await adminPage.locator('#invite-paid-since').fill('2026-01-15');
    await adminPage.getByRole('button', { name: 'Make an invitation link' }).click();
    await expect(adminPage.getByText('A pending invitation already exists')).toBeVisible();

    await superPage.goto('/admin/users');
    await expect(superPage.getByRole('row').filter({ hasText: people.member.email })).toBeVisible();
    await invite(superPage, people.second.email);
    await adminPage.goto('/admin/users?invite=1');
    await expect(adminPage.getByText(people.second.email)).toHaveCount(0);

    const row = adminPage.getByRole('row').filter({ hasText: people.member.email });
    await row.getByRole('button', { name: 'Cancel invitation' }).click();
    // The confirmation says whose invitation it is.
    const confirm = adminPage.getByRole('dialog');
    await expect(confirm).toContainText(`Cancel the invitation for ${people.member.email}?`);
    await confirm.getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(adminPage.getByText('Invitation cancelled.')).toBeVisible({ timeout: 15_000 });

    const secondLink = await invite(adminPage, people.member.email);

    // Chat previews and mail scanners fetch a link as soon as it is shared, and a
    // person may open it more than once before continuing. None of that may spend it.
    for (const userAgent of ['Slackbot-LinkExpanding 1.0', 'Discordbot/2.0', 'Mozilla/5.0']) {
      const preview = await request.get(secondLink, { headers: { 'user-agent': userAgent } });
      expect(preview.status()).toBe(200);
      expect(preview.headers()['set-cookie'] ?? '').not.toContain('sb-');
    }
    expect((await request.head(secondLink)).status()).toBe(200);
    await memberPage.goto(secondLink);
    await memberPage.reload();

    // Someone already signed in, such as the admin testing a link, is warned first.
    await adminPage.goto(secondLink);
    await expect(adminPage.getByText(`You are signed in as ${people.admin.email}`)).toBeVisible();

    await memberPage.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(memberPage).toHaveURL(/\/invite\/accept$/, { timeout: 30_000 });
    // Two invitation rows exist for this email now; the live one must still win.
    await expect(memberPage.getByRole('heading', { name: 'Make it yours' })).toBeVisible();
  });

  test('member setup validates its input and keeps what was typed', async () => {
    const file = memberPage.locator('input[type="file"]');

    await file.setInputFiles({
      name: 'huge.jpg',
      mimeType: 'image/jpeg',
      buffer: randomBytes(2_200_000),
    });
    await expect(memberPage.getByText('Images must be 2 MB or smaller.')).toBeVisible();

    await file.setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"/>'),
    });
    await fillSetup(memberPage, memberName, people.member.password);
    await memberPage.getByRole('button', { name: 'Create my profile' }).click();
    await expect(memberPage.getByText('Use a JPEG, PNG or WebP image.')).toBeVisible({
      timeout: 15_000,
    });
    await expect(memberPage.getByLabel('Display name')).toHaveValue(memberName);

    await file.setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: PHOTO });
    await memberPage.locator('input[name="password"]').fill('onlylettersnodigits');
    await memberPage.locator('input[name="confirmPassword"]').fill('onlylettersnodigits');
    await memberPage.locator('input[name="photoAttestation"]').check();
    await memberPage.locator('input[name="acceptTerms"]').check();
    await memberPage.getByRole('button', { name: 'Create my profile' }).click();
    await expect(memberPage.getByText('Include at least one letter and one number')).toBeVisible({
      timeout: 15_000,
    });

    await file.setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: PHOTO });
    await fillSetup(memberPage, memberName, people.member.password);
    await memberPage.getByRole('button', { name: 'Create my profile' }).click();
    await expect(memberPage).toHaveURL(/\/member\?welcome=1/, { timeout: 30_000 });
    await expect(memberPage.getByRole('heading', { name: memberName })).toBeVisible();

    const client = supabase();
    const { data: invitations } = await client
      .from('member_invitations')
      .select('status, auth_user_id')
      .eq('email', people.member.email)
      .eq('status', 'accepted');
    expect(invitations).toHaveLength(1);
    memberAuthId = invitations?.[0]?.auth_user_id as string;
    fixtureAuthIds.add(memberAuthId);

    const { data: member } = await client
      .from('members')
      .select('id, status, member_since, member_profiles(profile_slug)')
      .eq('auth_user_id', memberAuthId)
      .single();
    memberId = member?.id as string;
    const profile = member?.member_profiles as unknown as { profile_slug: string };
    memberSlug = profile.profile_slug;
    expect(member?.member_since).toBe('2026-01-15');

    // Rejected attempts must not leave photos behind.
    const { data: files } = await client.storage.from('avatars').list(`member/${memberAuthId}`);
    expect(files).toHaveLength(1);
  });

  test('a used invitation link cannot be replayed, and an existing member cannot be re-invited', async ({
    browser,
  }) => {
    const { data } = await supabase()
      .from('member_invitations')
      .select('status')
      .eq('email', people.member.email)
      .eq('status', 'pending');
    expect(data).toHaveLength(0);

    await adminPage.goto('/admin/users?invite=1');
    await adminPage.locator('#invite-email').fill(people.member.email);
    await adminPage.locator('#invite-paid-since').fill('2026-01-15');
    await adminPage.getByRole('button', { name: 'Make an invitation link' }).click();
    await expect(adminPage.getByText('That email already belongs to a member.')).toBeVisible();

    const stranger = await newPage(browser, 'replay');
    await useLink(
      stranger,
      '/auth/confirm?token_hash=not-a-real-token&type=invite&next=//evil.example',
    );
    await expect(stranger).toHaveURL(/\/login\?notice=invalid-link/);
    await expect(stranger.getByText('This link is invalid or already used.')).toBeVisible();

    await stranger.goto('/auth/confirm?token_hash=not-a-real-token&type=not-a-type');
    await expect(stranger).toHaveURL(/\/login\?notice=invalid-link/);
  });

  test('an expired invitation is explained and can be replaced', async ({ browser }) => {
    const client = supabase();
    const { data: pending } = await client
      .from('member_invitations')
      .select('id, auth_user_id')
      .eq('email', people.second.email)
      .eq('status', 'pending')
      .single();
    fixtureAuthIds.add(pending?.auth_user_id as string);
    await client
      .from('member_invitations')
      .update({ expires_at: new Date(Date.now() - HOUR).toISOString() })
      .eq('id', pending?.id);

    const freshLink = await invite(superPage, people.second.email);
    const { data: rows } = await client
      .from('member_invitations')
      .select('status')
      .eq('email', people.second.email)
      .order('created_at');
    expect(rows?.map((row) => row.status)).toEqual(['expired', 'pending']);

    const secondPage = await newPage(browser, 'second member');
    await useLink(secondPage, freshLink);
    await expect(secondPage).toHaveURL(/\/invite\/accept$/, { timeout: 30_000 });
    await secondPage.locator('input[type="file"]').setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: PHOTO,
    });
    await fillSetup(secondPage, 'Second Member', people.second.password);
    await secondPage.getByRole('button', { name: 'Create my profile' }).click();
    await expect(secondPage).toHaveURL(/\/member\?welcome=1/, { timeout: 30_000 });
    await secondPage.context().close();
  });

  test('members sign out and back in, and each user type lands on its own home', async () => {
    await memberPage.goto('/member');
    await memberPage
      .getByRole('button', { name: /sign out/i })
      .first()
      .click();
    await expect(memberPage).toHaveURL(/\/login\?notice=signed-out/, { timeout: 15_000 });
    await memberPage.goto('/member');
    await expect(memberPage).toHaveURL(/\/login\?next=%2Fmember/);

    await signIn(memberPage, people.member.email, people.member.password);
    await expect(memberPage).toHaveURL(/\/member$/, { timeout: 20_000 });
    await memberPage.goto('/login');
    await expect(memberPage).toHaveURL(/\/member$/);
    await memberPage.goto('/forgot-password');
    await expect(memberPage).toHaveURL(/\/member$/);
    await memberPage.goto('/admin');
    await expect(memberPage).toHaveURL(/notice=admin-required/);

    // Staff must not be stranded on the member setup screen.
    await superPage.goto('/member');
    await expect(superPage).toHaveURL(/\/admin$/);
    await superPage.goto('/login');
    await expect(superPage).toHaveURL(/\/admin$/);
  });

  test('a token refreshed while browsing a public page survives', async () => {
    const before = await memberContext.cookies();
    const session = readSession(before);
    const refreshToken = session.refresh_token as string;

    const expired = Buffer.from(JSON.stringify({ ...session, expires_at: 1 }), 'utf8').toString(
      'base64url',
    );
    const value = `base64-${expired}`;
    const template = before.find((cookie) => /^sb-.*-auth-token/.test(cookie.name));
    if (!template) throw new Error('No session cookie.');
    const base = template.name.replace(/\.\d+$/, '');
    await memberContext.clearCookies({ name: new RegExp(`^${base}`) });
    const chunks = value.match(/.{1,3180}/g) ?? [];
    await memberContext.addCookies(
      chunks.map((chunk, index) => ({
        ...template,
        name: chunks.length === 1 ? base : `${base}.${index}`,
        value: chunk,
      })),
    );

    await memberPage.goto('/events');
    const after = readSession(await memberContext.cookies());
    expect(after.refresh_token, 'the proxy must persist the rotated token').not.toBe(refreshToken);
    expect(after.expires_at).toBeGreaterThan(Date.now() / 1000);

    await memberPage.goto('/member');
    await expect(memberPage).toHaveURL(/\/member$/);
    await expect(memberPage.getByRole('heading', { name: memberName })).toBeVisible();
  });

  test('profiles accept real photos up to 2 MB and refuse unsafe links', async () => {
    const client = supabase();
    const { data: before } = await client
      .from('member_profiles')
      .select('photo_path')
      .eq('member_id', memberId)
      .single();

    await memberPage.goto('/member/profile');
    await memberPage.getByRole('button', { name: 'Add link' }).click();
    await memberPage.locator('#link-label-0').fill('Plain');
    await memberPage.locator('#link-url-0').fill('http://insecure.example');
    await memberPage.getByRole('button', { name: 'Save profile' }).click();
    await expect(memberPage.getByText('Only https:// links are allowed')).toBeVisible({
      timeout: 15_000,
    });

    let size = 700;
    let photo: Buffer = Buffer.alloc(0);
    while (photo.length < 1_200_000 && size < 2000) {
      photo = await sharp(randomBytes(size * size * 3), {
        raw: { width: size, height: size, channels: 3 },
      })
        .jpeg({ quality: 85 })
        .toBuffer();
      size += 100;
    }
    expect(photo.length).toBeGreaterThan(1_000_000);
    expect(photo.length).toBeLessThan(2_097_152);

    await memberPage.locator('#profile-name').fill(`${memberName} Two`);
    await memberPage.locator('#profile-about').fill('Testing every workflow.');
    await memberPage.locator('#link-label-0').fill('Site');
    await memberPage.locator('#link-url-0').fill('https://example.com/me');
    await memberPage.locator('#profile-photo').setInputFiles({
      name: 'large.jpg',
      mimeType: 'image/jpeg',
      buffer: photo,
    });
    await memberPage.getByRole('button', { name: 'Save profile' }).click();
    await expect(memberPage.getByText('Profile saved.')).toBeVisible({ timeout: 20_000 });

    const { data: after } = await client
      .from('member_profiles')
      .select('photo_path, display_name, about, links')
      .eq('member_id', memberId)
      .single();
    expect(after?.photo_path).not.toBe(before?.photo_path);
    expect(after?.display_name).toBe(`${memberName} Two`);
    const { data: files } = await client.storage.from('avatars').list(`member/${memberAuthId}`);
    expect(files, 'the previous photo must be removed').toHaveLength(1);

    const { data: audit } = await client
      .from('audit_log')
      .select('before, after')
      .eq('action', 'member.profile_updated')
      .eq('target_id', memberId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(audit?.before).toBeNull();
    expect(audit?.after).toEqual({ changed: ['display_name', 'about', 'links', 'photo'] });

    await memberPage.locator('#profile-name').fill(memberName);
    await memberPage.getByRole('button', { name: 'Save profile' }).click();
    await expect(memberPage.getByText('Profile saved.')).toBeVisible({ timeout: 20_000 });
  });

  test('the member area has four tabs and puts the ID first', async () => {
    const tabs = memberPage.getByRole('navigation', { name: 'Member sections' });
    const current = tabs.locator('[aria-current="page"]');
    await memberPage.goto('/member');
    await expect(tabs.getByRole('link')).toHaveText(['Home', 'Activity', 'Rewards', 'Profile']);
    await expect(current).toHaveText('Home');
    await memberPage.getByRole('link', { name: 'Show my ID' }).click();
    await expect(memberPage).toHaveURL(/\/member\/id$/);
    await expect(current).toHaveText('Home');
    // Privacy is part of the profile page; its old address still works.
    await memberPage.goto('/member/privacy');
    await expect(memberPage).toHaveURL(/\/member\/profile/);
    await expect(current).toHaveText('Profile');
    await expect(memberPage.getByRole('heading', { name: 'What others can see' })).toBeVisible();
  });

  test('privacy settings control the public profile, photo and leaderboard', async () => {
    const photoUrl = `/api/profile-photo/${memberSlug}`;
    await anonPage.goto(`/m/${memberSlug}`);
    await expect(anonPage.getByRole('heading', { name: memberName })).toBeVisible();
    await expect(anonPage.getByText(people.member.email)).toBeVisible();
    await expect(anonPage.getByRole('link', { name: 'Site' })).toHaveAttribute(
      'href',
      'https://example.com/me',
    );
    expect((await anonPage.request.get(photoUrl)).status()).toBe(200);

    // Each switch saves as it is flipped; there is no Save button.
    const saved = memberPage.getByText('Saved.', { exact: true });
    await memberPage.goto('/member/profile');
    await expect(memberPage.getByRole('button', { name: /Save privacy/ })).toHaveCount(0);
    await memberPage.getByRole('switch', { name: 'Email address' }).click();
    await memberPage.getByRole('switch', { name: 'Profile photo' }).click();
    await memberPage.getByRole('switch', { name: 'Short bio' }).click();
    await expect(saved).toBeVisible({ timeout: 15_000 });

    await anonPage.goto(`/m/${memberSlug}`);
    await expect(anonPage.getByRole('heading', { name: memberName })).toBeVisible();
    await expect(anonPage.getByText(people.member.email)).toHaveCount(0);
    await expect(anonPage.getByText('Testing every workflow.')).toHaveCount(0);
    expect((await anonPage.request.get(photoUrl)).status()).toBe(404);
    expect((await memberPage.request.get(photoUrl)).status()).toBe(200);

    await memberPage.reload();
    await memberPage.getByRole('switch', { name: 'Public profile' }).click();
    await expect(saved).toBeVisible({ timeout: 15_000 });
    await anonPage.goto(`/m/${memberSlug}`);
    await expect(anonPage.getByRole('heading', { name: 'This profile is private' })).toBeVisible();
    await expect(anonPage.getByText(memberName)).toHaveCount(0);

    await memberPage.reload();
    await memberPage.getByRole('switch', { name: 'Public profile' }).click();
    await memberPage.getByRole('switch', { name: 'Email address' }).click();
    await memberPage.getByRole('switch', { name: 'Profile photo' }).click();
    await memberPage.getByRole('switch', { name: 'Short bio' }).click();
    await expect(saved).toBeVisible({ timeout: 15_000 });
  });

  test('events are created from the short form, published and edited without shifting times', async () => {
    const now = Date.now();
    const client = supabase();
    type StoredSession = {
      id: string;
      kind: string;
      minimum_duration_minutes: number;
      reward_points: number;
      check_in_opens_at: string;
      check_in_closes_at: string;
      check_out_opens_at: string;
      check_out_closes_at: string;
    };
    const sessionColumns =
      'id, kind, minimum_duration_minutes, reward_points, check_in_opens_at, check_in_closes_at, check_out_opens_at, check_out_closes_at';
    const at = (value: string | undefined) => new Date(value ?? 0).getTime();

    await adminPage.goto('/admin/events');
    await adminPage.getByRole('link', { name: 'New event' }).click();
    await expect(adminPage).toHaveURL(/\/admin\/events\/new$/);

    await adminPage.locator('#event-name').fill(eventName);
    await adminPage.locator('#event-summary').fill('A workflow test event.');
    await adminPage.locator('#event-location').fill('Westgate 101');
    await adminPage.locator('#event-starts').fill(newYorkInput(now - HOUR));
    await adminPage.locator('#event-ends').fill(newYorkInput(now - 2 * HOUR));
    await adminPage.locator('#event-points').fill('20');
    await adminPage.getByText('Attendance rules', { exact: true }).click();
    await adminPage.locator('#event-arrive-by').selectOption('end');
    await adminPage.locator('#event-leave-from').selectOption('start');

    await adminPage.getByRole('button', { name: 'Create event' }).click();
    await expect(adminPage.getByText('The event must end after it starts')).toBeVisible({
      timeout: 15_000,
    });
    // A validation error must not throw away what was typed.
    await expect(adminPage.locator('#event-name')).toHaveValue(eventName);
    await expect(adminPage.locator('#event-arrive-by')).toHaveValue('end');

    await adminPage.locator('#event-ends').fill(newYorkInput(now + 3 * HOUR));
    await adminPage.getByRole('button', { name: 'Create event' }).click();
    await expect(adminPage.getByText('Event saved as a draft.')).toBeVisible({ timeout: 15_000 });
    await expect(adminPage).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);

    // The web address comes from the name, and a new event is always a draft.
    const { data: event } = await client
      .from('events')
      .select(`id, starts_at, ends_at, status, event_sessions(${sessionColumns})`)
      .eq('slug', eventSlug)
      .single();
    eventId = event?.id as string;
    expect(event?.status).toBe('draft');
    const sessions = event?.event_sessions as unknown as StoredSession[];
    expect(sessions).toHaveLength(1);
    const main = sessions[0] as StoredSession;
    mainSessionId = main.id;
    expect(main).toMatchObject({ kind: 'main', reward_points: 20, minimum_duration_minutes: 0 });

    // The two attendance rules became the four stored times.
    const start = at(event?.starts_at);
    const end = at(event?.ends_at);
    expect(at(main.check_in_opens_at)).toBe(start - HOUR / 2);
    expect(at(main.check_in_closes_at)).toBe(end);
    expect(at(main.check_out_opens_at)).toBe(start);
    expect(at(main.check_out_closes_at)).toBe(end + HOUR);

    // The same name again gets its own address instead of an error.
    await adminPage.goto('/admin/events/new');
    await adminPage.locator('#event-name').fill(eventName);
    await adminPage.locator('#event-starts').fill(newYorkInput(now + 24 * HOUR));
    await adminPage.locator('#event-ends').fill(newYorkInput(now + 26 * HOUR));
    await adminPage.getByRole('button', { name: 'Create event' }).click();
    await expect(adminPage.getByText('Event saved as a draft.')).toBeVisible({ timeout: 15_000 });
    const { data: twins } = await client
      .from('events')
      .select('slug')
      .like('slug', `${eventSlug}%`)
      .order('created_at');
    expect(twins?.map((row) => row.slug)).toEqual([eventSlug, `${eventSlug}-2`]);
    await client.from('events').delete().eq('slug', `${eventSlug}-2`);

    // Drafts stay private.
    await anonPage.goto(`/events/${eventSlug}`);
    await expect(anonPage.getByRole('heading', { name: 'Workflow Event' })).toHaveCount(0);

    // Saving without touching anything must not move any time or the address.
    await adminPage.goto(`/admin/events/${eventId}`);
    await adminPage.getByRole('button', { name: 'Save changes' }).click();
    await expect(adminPage.getByText('Event saved.')).toBeVisible({ timeout: 15_000 });
    const { data: resaved } = await client
      .from('events')
      .select(`slug, starts_at, ends_at, event_sessions(${sessionColumns})`)
      .eq('id', eventId)
      .single();
    expect(resaved?.slug).toBe(eventSlug);
    expect(at(resaved?.starts_at)).toBe(start);
    expect(at(resaved?.ends_at)).toBe(end);
    const resavedMain = (resaved?.event_sessions as unknown as StoredSession[])[0] as StoredSession;
    for (const column of [
      'check_in_opens_at',
      'check_in_closes_at',
      'check_out_opens_at',
      'check_out_closes_at',
    ] as const) {
      expect(at(resavedMain[column])).toBe(at(main[column]));
    }

    await adminPage.getByRole('button', { name: 'Publish' }).click();
    await expect(adminPage.getByText('Event published.')).toBeVisible({ timeout: 15_000 });
    await anonPage.goto('/events');
    await expect(anonPage.getByText('Workflow Event')).toBeVisible();
    await anonPage.goto(`/events/${eventSlug}`);
    await expect(anonPage.getByRole('heading', { name: 'Workflow Event' })).toBeVisible();
    // Members are told the rule in plain words.
    await expect(anonPage.getByText(/Check in by .+ · check out from .+/)).toBeVisible();
    const api = await anonPage.request.get('/api/public/events');
    expect(JSON.stringify(await api.json())).toContain(eventSlug);

    // A bonus session is added by editing the event.
    const saveBonus = async (name: string) => {
      await adminPage.goto(`/admin/events/${eventId}`);
      const section = adminPage.locator('details').filter({ hasText: 'Bonus session (optional)' });
      if ((await section.getAttribute('open')) === null) {
        await adminPage.getByText('Bonus session (optional)', { exact: true }).click();
      }
      await adminPage.locator('#bonus-name').fill(name);
      await adminPage.locator('#bonus-starts').fill(newYorkInput(now - HOUR));
      await adminPage.locator('#bonus-ends').fill(newYorkInput(now + 3 * HOUR));
      await adminPage.locator('#bonus-points').fill('15');
      await adminPage.getByRole('button', { name: 'Save changes' }).click();
      await expect(adminPage.getByText('Event saved.')).toBeVisible({ timeout: 15_000 });
      return client
        .from('event_sessions')
        .select('id, minimum_duration_minutes, reward_points')
        .eq('event_id', eventId)
        .eq('kind', 'bonus');
    };
    const { data: added } = await saveBonus('Bonus lab');
    expect(added).toHaveLength(1);
    expect(added?.[0]).toMatchObject({ reward_points: 15, minimum_duration_minutes: 0 });

    // Emptying its name removes a bonus session nobody has attended.
    const { data: removed } = await saveBonus('');
    expect(removed).toHaveLength(0);

    const { data: bonus } = await saveBonus('Bonus lab');
    bonusSessionId = bonus?.[0]?.id as string;
  });

  test('a card is written, checked and switched on in one go, and a new one replaces the old', async () => {
    const client = supabase();
    const lookup = async (url: string) => {
      await anonPage.goto(new URL(url).pathname);
      return new URL(anonPage.url()).pathname;
    };
    const writeButton = adminPage.getByRole('button', { name: 'Write card' });
    const written = `${memberName}'s card is written and working.`;
    const onReader = () =>
      adminPage.evaluate(() => (window as unknown as { __cardUri: string | null }).__cardUri);
    const choose = async () => {
      await adminPage.locator('#card-holder-search').fill('workflow mem');
      await adminPage
        .getByRole('list', { name: 'People found' })
        .getByRole('button', { name: memberName })
        .click();
    };

    await adminPage.goto('/admin/cards');
    // Nothing can be written until the reader is connected and someone is chosen.
    await expect(writeButton).toBeDisabled();
    await adminPage.getByRole('button', { name: 'Connect reader' }).click();
    await expect(adminPage.getByText('Reader connected')).toBeVisible({ timeout: 15_000 });
    await expect(writeButton).toBeDisabled();

    await adminPage.locator('#card-holder-search').fill('zzz-nobody');
    await expect(adminPage.getByText('Nobody active matches.')).toBeVisible({ timeout: 15_000 });
    await choose();
    await writeButton.click();
    await expect(adminPage.getByText(written)).toBeVisible({ timeout: 20_000 });
    firstCardUrl = (await onReader()) ?? '';
    expect(new URL(firstCardUrl).origin).toBe(origin);
    expect(new URL(firstCardUrl).pathname).toMatch(/^\/c\/[A-Za-z0-9_-]{43}$/);
    expect(await lookup(firstCardUrl)).toBe(`/m/${memberSlug}`);

    // The reader gives back exactly what was written.
    await adminPage.getByText('Reader tools').click();
    await adminPage.getByRole('button', { name: 'Read a card' }).click();
    await expect(adminPage.locator('p.break-all')).toHaveText(firstCardUrl, { timeout: 10_000 });

    await memberPage.goto('/member');
    await expect(memberPage.getByText('Tap at any kiosk.')).toBeVisible();

    // The written card has to leave the reader before another can be written, or
    // the next person's link would land on it.
    await choose();
    await expect(adminPage.getByText(`${memberName} already has a card.`)).toBeVisible();
    await expect(adminPage.getByText('Lift the last card off the reader')).toBeVisible();
    await expect(writeButton).toBeDisabled();
    await setCard(adminPage, null);
    await expect(writeButton).toBeEnabled({ timeout: 15_000 });

    // A write that does not read back correctly switches nothing on, and the
    // working card keeps working.
    await adminPage.evaluate(() => {
      (window as unknown as { __corruptWrites: boolean }).__corruptWrites = true;
    });
    await writeButton.click();
    await expect(adminPage.getByText('The card did not save correctly.')).toBeVisible({
      timeout: 20_000,
    });
    const replacementUrl = ((await onReader()) ?? '').replace(/#corrupt$/, '');
    expect(replacementUrl).not.toBe(firstCardUrl);
    expect(await lookup(firstCardUrl)).toBe(`/m/${memberSlug}`);
    expect(await lookup(replacementUrl)).toBe('/card-unavailable');

    // Trying again reuses the same card rather than preparing another.
    await adminPage.evaluate(() => {
      (window as unknown as { __corruptWrites: boolean }).__corruptWrites = false;
    });
    await writeButton.click();
    await expect(adminPage.getByText(written)).toBeVisible({ timeout: 20_000 });
    expect(await onReader()).toBe(replacementUrl);
    expect(await lookup(firstCardUrl)).toBe('/card-unavailable');
    expect(await lookup(replacementUrl)).toBe(`/m/${memberSlug}`);
    const { data: cards } = await client
      .from('card_credentials')
      .select('status')
      .eq('member_id', memberId)
      .order('created_at');
    expect(cards?.map((card) => card.status)).toEqual(['replaced', 'active']);
    activeCardUrl = replacementUrl;
  });

  test('the kiosk reads by itself, checks people in and out, and enforces the PSU ID rule', async () => {
    const client = supabase();
    await adminPage.goto('/admin/kiosk');
    await adminPage.locator('#kiosk-session').selectOption(mainSessionId);
    await connectReader(adminPage);

    // There is no Read button: a card is read as soon as it is on the reader.
    await expect(adminPage.getByRole('button', { name: 'Read card' })).toHaveCount(0);
    const expectPerson = (name = memberName) =>
      expect(adminPage.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });

    // Reader problems are explained in words, and reading carries on afterwards.
    await setCard(adminPage, 'error:nfc_not_ready');
    await expect(adminPage.getByText('The NFC module is not responding.')).toBeVisible({
      timeout: 15_000,
    });
    await tapCard(adminPage, 'error:ndef_record_missing');
    await expect(adminPage.getByText('This card has no readable URL on it.')).toBeVisible({
      timeout: 15_000,
    });

    // A card that is not ours is refused with a clear message.
    await tapCard(adminPage, 'https://example.com/not-a-card');
    await expect(
      adminPage.getByText('That tag does not contain a valid GDG card URL.'),
    ).toBeVisible({ timeout: 15_000 });

    // A replaced card is refused too, and is not read again while it stays put.
    await tapCard(adminPage, firstCardUrl);
    await expect(adminPage.getByText('That card is not active.')).toBeVisible({ timeout: 15_000 });
    await expect(adminPage.getByText('Lift the card off the reader').first()).toBeVisible();

    // A read alone records nothing, and a dismissed scan stays that way.
    await tapCard(adminPage, activeCardUrl);
    await expectPerson();
    await expect(adminPage.getByText('Identified by: Card')).toBeVisible();
    await adminPage.getByRole('button', { name: 'Dismiss scan' }).click();
    await expect(adminPage.getByText('Scan dismissed. Nothing was recorded.')).toBeVisible({
      timeout: 15_000,
    });
    const { data: none } = await client
      .from('attendance_records')
      .select('id')
      .eq('member_id', memberId);
    expect(none).toHaveLength(0);

    // The photo is new, so the server refuses confirmation without an ID check.
    await tapCard(adminPage, activeCardUrl);
    await expectPerson();
    await expect(adminPage.getByRole('button', { name: 'PSU ID required' })).toBeDisabled();
    const { data: scan } = await client
      .from('device_scans')
      .select('id')
      .eq('member_id', memberId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    const skipped = await adminPage.request.post('/api/admin/kiosk/confirm', {
      headers: { origin },
      data: { scanId: scan?.id, action: 'check_in' },
    });
    expect(skipped.status()).toBe(400);
    expect((await skipped.json()).error.message).toContain('PSU ID');

    await adminPage.getByLabel("I checked this member's PSU ID").check();
    // The confirm button is the big one: it used to collapse to a sliver.
    const confirm = adminPage.getByRole('button', { name: 'Confirm check-in' });
    expect((await confirm.boundingBox())?.height).toBeGreaterThanOrEqual(56);
    await confirm.click();
    await expect(adminPage.getByText(`${memberName} checked in.`)).toBeVisible({ timeout: 20_000 });

    const { data: checkedIn } = await client
      .from('attendance_records')
      .select('state, check_in_method')
      .eq('member_id', memberId)
      .eq('session_id', mainSessionId)
      .single();
    expect(checkedIn).toEqual({ state: 'checked_in', check_in_method: 'card' });
    await expect.poll(async () => (await balance()).points).toBe(0);

    // The card is still on the reader, and it is not read again as the next person.
    await adminPage.waitForTimeout(1_000);
    await expect(adminPage.getByRole('heading', { name: memberName })).toHaveCount(0);
    await expect(adminPage.getByText('Lift the card off the reader').first()).toBeVisible();

    // An older photo needs no ID check.
    await client
      .from('member_profiles')
      .update({ photo_changed_at: new Date(Date.now() - 72 * HOUR).toISOString() })
      .eq('member_id', memberId);

    await tapCard(adminPage, activeCardUrl);
    await expectPerson();
    await expect(adminPage.getByText('Photo changed in the last 48 hours')).toHaveCount(0);
    await adminPage.getByRole('button', { name: 'Confirm check-out' }).click();
    await expect(adminPage.getByText(`${memberName} checked out.`)).toBeVisible({
      timeout: 20_000,
    });
    await expectBalance(20, 20);

    // A finished attendance cannot be repeated.
    await tapCard(adminPage, activeCardUrl);
    await expect(adminPage.getByText('already has a completed attendance record')).toBeVisible({
      timeout: 15_000,
    });

    // The form no longer sets a minimum stay, but an older event can still carry
    // one, and a short stay there earns nothing.
    await client
      .from('event_sessions')
      .update({ minimum_duration_minutes: 30 })
      .eq('id', bonusSessionId);
    await adminPage.locator('#kiosk-session').selectOption(bonusSessionId);
    await tapCard(adminPage, activeCardUrl);
    await expectPerson();
    await adminPage.getByRole('button', { name: 'Confirm check-in' }).click();
    await expect(adminPage.getByText(`${memberName} checked in.`)).toBeVisible({ timeout: 20_000 });
    await tapCard(adminPage, activeCardUrl);
    await expectPerson();
    await adminPage.getByRole('button', { name: 'Confirm check-out' }).click();
    await expect(adminPage.getByText(`${memberName} checked out.`)).toBeVisible({
      timeout: 20_000,
    });
    await expectBalance(20, 20);

    await memberPage.goto('/member/activity');
    await expect(memberPage.getByText('Workflow Event').first()).toBeVisible();
    await expect(memberPage.getByText('+20 points').first()).toBeVisible();
    // The session that earned nothing says why.
    await expect(
      memberPage.getByText(/You stayed \d+ min and this session needs 30\./),
    ).toBeVisible();

    await anonPage.goto('/leaderboard');
    await expect(anonPage.getByText(memberName).first()).toBeVisible();

    // The event page lists both attendance rows for organizers.
    await adminPage.goto(`/admin/events/${eventId}`);
    await expect(adminPage.getByRole('row').filter({ hasText: memberName })).toHaveCount(2);
  });

  test('a member without their card is found by name or by their QR code', async () => {
    const client = supabase();
    const { data: secondPrivate } = await client
      .from('member_private')
      .select('member_id')
      .eq('email', people.second.email)
      .single();
    const secondId = secondPrivate?.member_id as string;
    const { data: secondProfile } = await client
      .from('member_profiles')
      .select('profile_slug')
      .eq('member_id', secondId)
      .single();

    // No reader is connected here: these check-ins do not need one.
    await adminPage.goto(`/admin/kiosk?session=${mainSessionId}`);
    await expect(adminPage.locator('#kiosk-session')).toHaveValue(mainSessionId);

    await adminPage.locator('#kiosk-search').fill('zzz-nobody');
    await expect(adminPage.getByText('No active member matches.')).toBeVisible({ timeout: 15_000 });

    await adminPage.locator('#kiosk-search').fill('second mem');
    await adminPage
      .getByRole('list', { name: 'Members found' })
      .getByRole('button', { name: /Second Member/ })
      .click();
    await expect(adminPage.getByRole('heading', { name: 'Second Member' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(adminPage.getByText('Identified by: Found by organizer')).toBeVisible();

    // The same photo rule applies however the member was identified.
    await expect(adminPage.getByRole('button', { name: 'PSU ID required' })).toBeDisabled();
    await adminPage.getByLabel("I checked this member's PSU ID").check();
    await adminPage.getByRole('button', { name: 'Confirm check-in' }).click();
    await expect(adminPage.getByText('Second Member checked in.')).toBeVisible({ timeout: 20_000 });

    // The QR code on their digital ID is their profile link. A handheld scanner
    // types it and presses Enter; the camera hands over the same text.
    await adminPage.locator('#kiosk-search').fill(`${origin}/m/${secondProfile?.profile_slug}`);
    await adminPage.locator('#kiosk-search').press('Enter');
    await expect(adminPage.getByRole('heading', { name: 'Second Member' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(adminPage.getByText('Identified by: QR code')).toBeVisible();
    await adminPage.getByLabel("I checked this member's PSU ID").check();
    await adminPage.getByRole('button', { name: 'Confirm check-out' }).click();
    await expect(adminPage.getByText('Second Member checked out.')).toBeVisible({
      timeout: 20_000,
    });

    // The record shows how each step was done, and the points still land.
    const { data: record } = await client
      .from('attendance_records')
      .select('state, qualified, reward_points, check_in_method, check_out_method')
      .eq('member_id', secondId)
      .eq('session_id', mainSessionId)
      .single();
    expect(record).toEqual({
      state: 'completed',
      qualified: true,
      reward_points: 20,
      check_in_method: 'manual',
      check_out_method: 'qr',
    });
    await adminPage.goto(`/admin/events/${eventId}`);
    const row = adminPage.getByRole('row').filter({ hasText: 'Second Member' });
    await expect(row).toContainText('found by organizer');
    await expect(row).toContainText('QR code');

    // A GDG number works typed in full, and nonsense is refused in words.
    await adminPage.goto(`/admin/kiosk?session=${mainSessionId}`);
    await adminPage.locator('#kiosk-search').fill('https://example.com/not-a-member');
    await adminPage.locator('#kiosk-search').press('Enter');
    await expect(adminPage.getByText('That is not a member QR code or GDG number.')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('a session outside its window and a cancelled event are refused', async () => {
    const client = supabase();
    await client
      .from('event_sessions')
      .update({ check_in_opens_at: new Date(Date.now() + 5 * HOUR).toISOString() })
      .eq('id', bonusSessionId);
    await client.from('attendance_records').select('id').eq('session_id', bonusSessionId);

    await adminPage.goto(`/admin/events/${eventId}`);
    await adminPage.getByRole('button', { name: 'Cancel event' }).click();
    await expect(adminPage.getByText('Event cancelled.')).toBeVisible({ timeout: 15_000 });
    await anonPage.goto(`/events/${eventSlug}`);
    await expect(anonPage.getByRole('heading', { name: 'Workflow Event' })).toHaveCount(0);
    await adminPage.goto('/admin/kiosk');
    await expect(adminPage.locator(`#kiosk-session option[value="${mainSessionId}"]`)).toHaveCount(
      0,
    );

    // A cancelled event comes back as a draft, to be published again on purpose.
    await adminPage.goto(`/admin/events/${eventId}`);
    await adminPage.getByRole('button', { name: 'Restore as draft' }).click();
    await expect(adminPage.getByText('Event moved back to drafts.')).toBeVisible({
      timeout: 15_000,
    });
    await adminPage.getByRole('button', { name: 'Publish' }).click();
    await expect(adminPage.getByText('Event published.')).toBeVisible({ timeout: 15_000 });
    await client
      .from('event_sessions')
      .update({ check_in_opens_at: new Date(Date.now() - HOUR).toISOString() })
      .eq('id', bonusSessionId);
  });

  test('superadmins award points and correct attendance through every state', async () => {
    await adminPage.goto(`/admin/members/${memberId}`);
    await expect(adminPage).toHaveURL(/notice=superadmin-required/);

    await superPage.goto(`/admin/members/${memberId}`);
    await superPage.locator('#award-points').fill('5');
    await superPage.locator('#award-reason').fill('Helped run the event');
    await superPage.getByRole('button', { name: 'Award points + stars' }).click();
    await expect(superPage.getByText('Awarded 5 points and stars.')).toBeVisible({
      timeout: 15_000,
    });
    await expectBalance(25, 25);

    const { data: record } = await supabase()
      .from('attendance_records')
      .select('id')
      .eq('member_id', memberId)
      .eq('session_id', bonusSessionId)
      .single();
    const correct = async (action: string, reason: string, checkedOutAt?: string) => {
      const form = superPage.locator(`form:has(input[name="attendanceId"][value="${record?.id}"])`);
      if (checkedOutAt) await form.locator('input[name="checkedOutAt"]').fill(checkedOutAt);
      await form.locator('input[name="reason"]').fill(reason);
      await form.locator('select[name="action"]').selectOption(action);
      await form.getByRole('button', { name: 'Apply' }).click();
      // The banner from the previous correction is still on screen, so wait for
      // this one to finish before the next form is filled in.
      await superPage.waitForLoadState('networkidle');
    };

    await correct('qualify', 'Stayed the full session');
    await expect(superPage.getByText('Attendance corrected and audited.')).toBeVisible({
      timeout: 15_000,
    });
    await expectBalance(40, 40);

    await correct('qualify', 'Second attempt to qualify');
    await expect(superPage.getByText('This attendance is already qualified.')).toBeVisible({
      timeout: 15_000,
    });

    await correct('disqualify', 'Scanned in error');
    await expect(superPage.getByText('Attendance corrected and audited.')).toBeVisible({
      timeout: 15_000,
    });
    await expectBalance(25, 25);

    await correct('qualify', 'Confirmed after all');
    await expect(superPage.getByText('Attendance corrected and audited.')).toBeVisible({
      timeout: 15_000,
    });
    await expectBalance(40, 40);

    await correct('set_checkout', 'Wrong time entered', newYorkInput(Date.now() - 48 * HOUR));
    await expect(superPage.getByText('Check-out must be after check-in.')).toBeVisible({
      timeout: 15_000,
    });

    await memberPage.goto('/member/activity');
    await expect(memberPage.getByText('Correction').first()).toBeVisible();
  });

  test('members request, cancel and re-request rewards, and organizers decide them', async () => {
    const client = supabase();
    const rewardName = `WF ${stamp} sticker`;
    const secondReward = `WF ${stamp} mug`;
    const pricey = `WF ${stamp} jacket`;

    const addReward = async (name: string, cost: string, inventory: string) => {
      await adminPage.goto('/admin/rewards');
      await adminPage.locator('#reward-name').fill(name);
      await adminPage.locator('#reward-description').fill('Workflow test reward.');
      await adminPage.locator('#reward-cost').fill(cost);
      await adminPage.locator('#reward-inventory').fill(inventory);
      await adminPage.getByRole('button', { name: 'Create reward' }).click();
      await expect(adminPage.getByText('Reward saved.')).toBeVisible({ timeout: 15_000 });
    };
    await addReward(rewardName, '10', '1');
    await addReward(secondReward, '5', '');
    await addReward(pricey, '5000', '');

    const card = (name: string) =>
      memberPage
        .getByRole('heading', { name, exact: true })
        .locator('xpath=ancestor::div[.//form][1]');
    const request = async (name: string) => {
      await card(name).getByRole('button', { name: 'Request this' }).click();
      await memberPage.getByRole('button', { name: 'Reserve points' }).click();
    };
    const inventory = async () =>
      (await client.from('rewards').select('inventory').eq('name', rewardName).single()).data
        ?.inventory;
    const redemptions = async (name: string) =>
      (
        await client
          .from('redemptions')
          .select('id, status')
          .eq('member_id', memberId)
          .eq('reward_name_snapshot', name)
          .order('created_at')
      ).data ?? [];

    await memberPage.goto('/member/rewards');
    await expect(card(pricey).getByRole('button', { name: /Need \d+ more points/ })).toBeDisabled();

    await request(rewardName);
    await expect(memberPage.getByText('Requested. An organizer will follow up.')).toBeVisible({
      timeout: 15_000,
    });
    await expectBalance(30, 40);
    expect(await inventory()).toBe(0);

    await memberPage.getByRole('button', { name: `Cancel request for ${rewardName}` }).click();
    await expect(
      memberPage.getByRole('button', { name: `Cancel request for ${rewardName}` }),
    ).toHaveCount(0, { timeout: 15_000 });
    await expectBalance(40, 40);
    expect(await inventory()).toBe(1);

    // Asking again without reloading must create a new request.
    await request(rewardName);
    await expect(
      memberPage.getByRole('button', { name: `Cancel request for ${rewardName}` }),
    ).toBeVisible({ timeout: 15_000 });
    const afterRetry = await redemptions(rewardName);
    expect(afterRetry.map((row) => row.status)).toEqual(['cancelled', 'requested']);
    await expectBalance(30, 40);

    await adminPage.goto('/admin/rewards');
    const waiting = (name: string) =>
      adminPage
        .getByRole('list', { name: 'Requests waiting' })
        .locator('li')
        .filter({ hasText: name });
    // Each decision is one button: no dropdown, and nothing that cannot apply.
    await expect(waiting(rewardName).getByRole('button', { name: 'Handed over' })).toHaveCount(0);
    await waiting(rewardName).getByRole('button', { name: 'Approve' }).click();
    await expect(adminPage.getByText('Request approved.')).toBeVisible({ timeout: 15_000 });
    await expect(waiting(rewardName).getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await waiting(rewardName).getByRole('button', { name: 'Handed over' }).click();
    await expect(adminPage.getByText('Marked as handed over.')).toBeVisible({ timeout: 15_000 });
    expect((await redemptions(rewardName)).at(-1)?.status).toBe('fulfilled');
    // A handled request stays on the page as history.
    await expect(waiting(rewardName)).toHaveCount(0);
    await expect(
      adminPage.getByRole('list', { name: 'Recently handled' }).getByText(rewardName).first(),
    ).toBeVisible();
    await expectBalance(30, 40);

    await memberPage.goto('/member/rewards');
    await request(secondReward);
    await expect(memberPage.getByText('Requested. An organizer will follow up.')).toBeVisible({
      timeout: 15_000,
    });
    await expect.poll(async () => (await balance()).points).toBe(25);

    await adminPage.goto('/admin/rewards');
    // Rejecting asks for a reason first, because the member sees it.
    await waiting(secondReward).getByText('Reject', { exact: true }).click();
    const reason = waiting(secondReward).getByLabel('Reason the member will see');
    await waiting(secondReward).getByRole('button', { name: 'Reject and refund' }).click();
    await expect(reason).toHaveJSProperty('validity.valueMissing', true);
    expect((await redemptions(secondReward)).at(-1)?.status).toBe('requested');
    await reason.fill('Out of mugs');
    await waiting(secondReward).getByRole('button', { name: 'Reject and refund' }).click();
    await expect(adminPage.getByText('Request rejected and the points refunded.')).toBeVisible({
      timeout: 15_000,
    });
    await expectBalance(30, 40);
    await expect(
      adminPage.getByRole('list', { name: 'Recently handled' }).getByText('Out of mugs'),
    ).toBeVisible();

    // A sold-out reward says so, and edits to a reward show up for members.
    await memberPage.goto('/member/rewards');
    await expect(card(rewardName).getByRole('button', { name: 'Out of stock' })).toBeDisabled();
  });

  test('a recovery link resets a password once', async ({ browser }) => {
    const newPassword = `Wf-Recovered-${stamp}-5e`;
    await superPage.goto(`/admin/members/${memberId}`);
    await superPage.getByRole('button', { name: 'Make a password reset link' }).click();
    const link = await superPage.getByLabel('One-time sign-in link').inputValue();
    expect(new URL(link).origin).toBe(origin);
    expect(new URL(link).searchParams.get('next')).toBe('/account/password');
    await superPage.getByRole('button', { name: 'Done' }).click();

    const recovery = await newPage(browser, 'recovery');
    await useLink(recovery, link);
    await expect(recovery).toHaveURL(/\/account\/password$/, { timeout: 30_000 });
    await recovery.getByLabel('New password', { exact: true }).fill('onlylettersnodigits');
    await recovery.getByLabel('Confirm new password', { exact: true }).fill('onlylettersnodigits');
    await recovery.getByRole('button', { name: 'Set new password' }).click();
    await expect(recovery.getByText('Include at least one letter and one number')).toBeVisible({
      timeout: 15_000,
    });
    await recovery.getByLabel('New password', { exact: true }).fill(newPassword);
    await recovery.getByLabel('Confirm new password', { exact: true }).fill(newPassword);
    await recovery.getByRole('button', { name: 'Set new password' }).click();
    await expect(recovery).toHaveURL(/\/member$/, { timeout: 20_000 });

    const replay = await newPage(browser, 'replayed recovery');
    await useLink(replay, link);
    await expect(replay).toHaveURL(/\/login\?notice=invalid-link/, { timeout: 20_000 });

    const oldLogin = await newPage(browser, 'old password');
    await signIn(oldLogin, people.member.email, people.member.password);
    await expect(oldLogin.getByText('Email or password is incorrect.')).toBeVisible({
      timeout: 15_000,
    });
    await signIn(oldLogin, people.member.email, newPassword);
    await expect(oldLogin).toHaveURL(/\/member$/, { timeout: 20_000 });
    people.member.password = newPassword;

    // Changing a password ends the member's other sessions.
    await memberPage.goto('/member');
    await expect(memberPage).toHaveURL(/\/login/);
    await signIn(memberPage, people.member.email, newPassword);
    await expect(memberPage).toHaveURL(/\/member$/, { timeout: 20_000 });
  });

  test('a suspended member is locked out everywhere and can be restored', async ({ browser }) => {
    const setStatus = async (status: string, reason: string) => {
      await superPage.goto(`/admin/members/${memberId}`);
      await superPage.locator('#member-status').selectOption(status);
      await superPage.locator('#status-reason').fill(reason);
      await superPage.getByRole('button', { name: 'Update status' }).click();
      await expect(superPage.getByText('Member status updated.')).toBeVisible({ timeout: 15_000 });
    };

    // Preview a scan first, then suspend: confirmation must re-check.
    await adminPage.goto('/admin/kiosk');
    await adminPage.locator('#kiosk-session').selectOption(mainSessionId);
    const { data: extra } = await supabase()
      .from('device_scans')
      .insert({
        member_id: memberId,
        session_id: mainSessionId,
        action: 'check_in',
        status: 'pending',
        idempotency_key: `wf:${stamp}`,
      })
      .select('id')
      .single();

    await setStatus('suspended', 'Workflow test');

    const stale = await adminPage.request.post('/api/admin/kiosk/confirm', {
      headers: { origin },
      data: { scanId: extra?.id, action: 'check_in' },
    });
    expect(stale.status()).toBe(403);
    expect((await stale.json()).error.message).toBe('This membership is not active.');

    await memberPage.goto('/member');
    await expect(memberPage).toHaveURL(/\/account-suspended$/);
    await expect(
      memberPage.getByRole('heading', { name: 'This membership is inactive' }),
    ).toBeVisible();
    await memberPage.goto('/invite/accept');
    await expect(memberPage).toHaveURL(/\/account-suspended$/);

    await anonPage.goto(new URL(activeCardUrl).pathname);
    await expect(anonPage).toHaveURL(/\/card-unavailable$/);
    await anonPage.goto(`/m/${memberSlug}`);
    await expect(anonPage.getByRole('heading', { name: 'This profile is private' })).toBeVisible();
    await anonPage.goto('/leaderboard');
    await expect(anonPage.getByText(memberName)).toHaveCount(0);

    const blocked = await newPage(browser, 'suspended sign-in');
    await signIn(blocked, people.member.email, people.member.password);
    await expect(blocked.getByText('This membership is not active.')).toBeVisible({
      timeout: 15_000,
    });

    await setStatus('active', 'Workflow test restored');
    await memberPage.goto('/member');
    await expect(memberPage).toHaveURL(/\/member$/);
    await anonPage.goto(new URL(activeCardUrl).pathname);
    await expect(anonPage).toHaveURL(new RegExp(`/m/${memberSlug}$`));
  });

  test('signing out on one device leaves the others signed in', async ({ browser }) => {
    const phone = await newPage(browser, 'second device');
    await signIn(phone, people.member.email, people.member.password);
    await expect(phone).toHaveURL(/\/member$/, { timeout: 20_000 });
    await phone
      .getByRole('button', { name: /sign out/i })
      .first()
      .click();
    await expect(phone).toHaveURL(/\/login\?notice=signed-out/, { timeout: 15_000 });
    await phone.goto('/member');
    await expect(phone).toHaveURL(/\/login/);

    await memberPage.goto('/member');
    await expect(memberPage).toHaveURL(/\/member$/);
    await expect(memberPage.getByRole('heading', { name: memberName })).toBeVisible();
  });

  test('a revoked card stops working, including for a scan already on screen', async () => {
    await adminPage.goto('/admin/kiosk');
    await adminPage.locator('#kiosk-session').selectOption(bonusSessionId);

    // The bonus attendance is complete, so start from a fresh session for this.
    const client = supabase();
    const now = Date.now();
    const { data: session } = await client
      .from('event_sessions')
      .insert({
        event_id: eventId,
        name: 'Extra lab',
        kind: 'bonus',
        starts_at: new Date(now - HOUR).toISOString(),
        ends_at: new Date(now + HOUR).toISOString(),
        check_in_opens_at: new Date(now - HOUR).toISOString(),
        check_in_closes_at: new Date(now + HOUR).toISOString(),
        check_out_opens_at: new Date(now - HOUR).toISOString(),
        check_out_closes_at: new Date(now + HOUR).toISOString(),
        minimum_duration_minutes: 0,
        reward_points: 0,
      })
      .select('id')
      .single();
    await adminPage.reload();
    await adminPage.locator('#kiosk-session').selectOption(session?.id as string);
    await connectReader(adminPage);
    await setCard(adminPage, activeCardUrl);
    await expect(adminPage.getByRole('heading', { name: memberName })).toBeVisible({
      timeout: 20_000,
    });

    const { data: card } = await client
      .from('card_credentials')
      .select('id')
      .eq('member_id', memberId)
      .eq('status', 'active')
      .single();
    await superPage.goto('/admin/cards');
    await superPage
      .locator(`form:has(input[name="cardId"][value="${card?.id}"])`)
      .getByRole('button', { name: 'Switch off' })
      .click();
    await expect(superPage.getByText('Card switched off.')).toBeVisible({ timeout: 15_000 });

    await adminPage.getByRole('button', { name: 'Confirm check-in' }).click();
    await expect(adminPage.getByText('This card is no longer active.')).toBeVisible({
      timeout: 15_000,
    });

    await anonPage.goto(new URL(activeCardUrl).pathname);
    await expect(anonPage).toHaveURL(/\/card-unavailable$/);
    await anonPage.goto(`/m/${memberSlug}`);
    await expect(anonPage.getByRole('heading', { name: memberName })).toBeVisible();
    await memberPage.goto('/member');
    await expect(memberPage.getByText('Marked lost.')).toBeVisible();
  });

  test('user types convert both ways and keep the profile and card', async ({ browser }) => {
    const client = supabase();
    const { data: invitation } = await client
      .from('member_invitations')
      .select('auth_user_id')
      .eq('email', people.second.email)
      .eq('status', 'accepted')
      .single();
    const secondAuthId = invitation?.auth_user_id as string;
    const secondRow = () => superPage.getByRole('row').filter({ hasText: people.second.email });
    const secondMember = async () => {
      const { data } = await client
        .from('members')
        .select('id, kind, status, member_profiles(profile_slug, photo_path)')
        .eq('auth_user_id', secondAuthId)
        .single();
      const profile = data?.member_profiles as unknown as {
        profile_slug: string;
        photo_path: string | null;
      };
      return { id: data?.id as string, kind: data?.kind, status: data?.status, ...profile };
    };
    const before = await secondMember();
    const { count: pointsBefore } = await client
      .from('point_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', before.id);
    expect(pointsBefore).toBeGreaterThan(0);

    // A normal admin can revoke a member, and that member can no longer sign in.
    await adminPage.goto('/admin/users');
    await adminPage
      .getByRole('row')
      .filter({ hasText: people.second.email })
      .getByRole('button', { name: 'Remove access' })
      .click();
    // The confirmation names the person, so the wrong row is hard to act on.
    await expect(adminPage.getByRole('dialog')).toContainText("Remove Second Member's access?");
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Yes, remove access' }).click();
    await expect(adminPage.getByText('Member access removed.')).toBeVisible({ timeout: 15_000 });
    const second = await newPage(browser, 'second member again');
    await signIn(second, people.second.email, people.second.password);
    await expect(second.getByText('This membership is not active.')).toBeVisible({
      timeout: 15_000,
    });

    // Member -> admin keeps the profile and card, and drops the points.
    await superPage.goto('/admin/users');
    await secondRow().getByRole('link', { name: 'Manage' }).click();
    await expect(superPage).toHaveURL(new RegExp(`/admin/members/${before.id}$`));
    // A member is only offered the types they are not.
    await expect(superPage.getByRole('button', { name: 'Make member' })).toHaveCount(0);
    await superPage.getByRole('button', { name: 'Make admin' }).click();
    await expect(superPage.getByRole('dialog')).toContainText('Make Second Member an admin?');
    await expect(superPage.getByRole('dialog')).toContainText('deleted for good');
    await superPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Yes, make them an admin' })
      .click();
    await expect(
      superPage.getByText(
        'Their profile and card were kept; their points and attendance history were removed.',
      ),
    ).toBeVisible({ timeout: 15_000 });
    const promoted = await secondMember();
    expect(promoted).toMatchObject({
      id: before.id,
      kind: 'organizer',
      status: 'active',
      profile_slug: before.profile_slug,
      photo_path: before.photo_path,
    });
    for (const table of ['point_ledger', 'star_ledger', 'attendance_records']) {
      const { count } = await client
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('member_id', before.id);
      expect(count).toBe(0);
    }

    // An organizer has a manage page of their own, and their member address leads to it.
    await superPage.goto(`/admin/members/${before.id}`);
    await expect(superPage).toHaveURL(new RegExp(`/admin/staff/${secondAuthId}$`));
    await expect(superPage.getByRole('heading', { name: 'Second Member' })).toBeVisible();
    await expect(superPage.locator('main').getByText('Admin', { exact: true })).toBeVisible();
    await expect(superPage.getByRole('link', { name: 'Write a card for them' })).toHaveAttribute(
      'href',
      `/admin/cards?member=${before.id}`,
    );
    await expect(
      superPage.getByRole('button', { name: 'Make a password reset link' }),
    ).toBeVisible();

    // Their page now says Organizer, with no points, and they are off the board.
    await anonPage.goto(`/m/${before.profile_slug}`);
    await expect(anonPage.getByRole('heading', { name: 'Second Member' })).toBeVisible();
    await expect(anonPage.getByText('Organizer', { exact: true })).toBeVisible();
    await expect(anonPage.getByText('Lifetime stars')).toHaveCount(0);
    await anonPage.goto('/leaderboard');
    await expect(anonPage.getByText('Second Member')).toHaveCount(0);

    // An organizer is never checked in, by search or by their QR code.
    await adminPage.goto(`/admin/kiosk?session=${mainSessionId}`);
    await adminPage.locator('#kiosk-search').fill('second mem');
    await expect(adminPage.getByText('No active member matches.')).toBeVisible({ timeout: 15_000 });
    await adminPage.locator('#kiosk-search').fill(`${origin}/m/${before.profile_slug}`);
    await adminPage.locator('#kiosk-search').press('Enter');
    await expect(adminPage.getByText('That is an organizer.')).toBeVisible({ timeout: 15_000 });
    // The database refuses too, whatever the app does.
    const { error: pointsError } = await client.rpc('grant_points', {
      p_member_id: before.id,
      p_points: 5,
      p_kind: 'interaction_reward',
      p_source_key: `wf:organizer:${stamp}`,
      p_description: 'Must be refused',
    });
    expect(pointsError?.message).toContain('organizer_has_no_member_activity');

    // They sign in as staff, and their kept profile means no setup step.
    await signIn(second, people.second.email, people.second.password);
    await enrollTotp(second);
    await second.goto('/admin/profile');
    await expect(second.getByRole('heading', { name: 'My profile' })).toBeVisible();

    // Admin -> member turns the same profile back into a member's, with no setup.
    await superPage.goto('/admin/users');
    await secondRow().getByRole('link', { name: 'Manage' }).click();
    await expect(superPage).toHaveURL(new RegExp(`/admin/staff/${secondAuthId}$`));
    await superPage.getByRole('button', { name: 'Make member' }).click();
    await expect(superPage.getByRole('dialog')).toContainText('Make Second Member a member?');
    await superPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Yes, make them a member' })
      .click();
    await expect(superPage.getByText('Changed to member.')).toBeVisible({ timeout: 15_000 });
    expect(await secondMember()).toMatchObject({
      id: before.id,
      kind: 'member',
      status: 'active',
      profile_slug: before.profile_slug,
    });
    await second.goto('/member');
    await expect(second.getByRole('heading', { name: 'Second Member' })).toBeVisible();
    await second.goto('/admin');
    await expect(second).not.toHaveURL(/\/admin$/);

    // Nobody manages themselves: a superadmin's own row leads to their profile.
    await expect(
      superPage
        .getByRole('row')
        .filter({ hasText: people.superadmin.email })
        .getByRole('link', { name: 'My profile' }),
    ).toHaveAttribute('href', '/admin/profile');
  });

  test('an organizer has a profile of their own, and staff emails cannot be invited as members', async () => {
    const client = supabase();
    const { data: ownPrivate } = await client
      .from('member_private')
      .select('member_id')
      .eq('email', people.superadmin.email)
      .single();
    const { data: own } = await client
      .from('members')
      .select('kind, member_profiles(profile_slug, photo_path)')
      .eq('id', ownPrivate?.member_id as string)
      .single();
    const slug = (own?.member_profiles as unknown as { profile_slug: string }).profile_slug;
    expect(own?.kind).toBe('organizer');

    // Their name in the header opens their own profile.
    await superPage.goto('/admin');
    await superPage.locator('header a[href="/admin/profile"]').first().click();
    await expect(superPage).toHaveURL(/\/admin\/profile$/);
    // An organizer has no number, points or leaderboard place to show or hide.
    const settings = superPage.locator('main');
    await expect(settings.getByText('Member number')).toHaveCount(0);
    await expect(settings.getByText('Leaderboard', { exact: true })).toHaveCount(0);
    await expect(settings.getByText('Email address')).toBeVisible();

    // No photo is needed to save, unlike a member's profile.
    await superPage.locator('#profile-name').fill('Olive Organizer');
    await superPage.getByRole('button', { name: 'Save profile' }).click();
    await expect(superPage.getByText('Profile saved.')).toBeVisible({ timeout: 15_000 });

    await anonPage.goto(`/m/${slug}`);
    await expect(anonPage.getByRole('heading', { name: 'Olive Organizer' })).toBeVisible();
    await expect(anonPage.getByText('Organizer', { exact: true })).toBeVisible();
    await expect(anonPage.getByText('Spendable points')).toHaveCount(0);

    // The Users list shows the name they chose.
    await superPage.goto('/admin/users');
    await expect(
      superPage.getByRole('row').filter({ hasText: people.superadmin.email }),
    ).toContainText('Olive Organizer');

    // A staff email is refused as a member before any link is generated.
    await adminPage.goto('/admin/users?invite=1');
    await adminPage.locator('#invite-email').fill(people.superadmin.email);
    await adminPage.locator('#invite-paid-since').fill('2026-01-15');
    await adminPage.getByRole('button', { name: 'Make an invitation link' }).click();
    await expect(adminPage.getByText('That email already has staff access.')).toBeVisible({
      timeout: 15_000,
    });

    // The member area is not theirs.
    await superPage.goto('/member');
    await expect(superPage).toHaveURL(/\/admin$/);
  });

  test('a returning staff member verifies TOTP, and the audit log records the work', async ({
    browser,
  }) => {
    const again = await newPage(browser, 'superadmin again');
    await signIn(again, people.superadmin.email, people.superadmin.password);
    await expect(again).toHaveURL(/\/admin-mfa/, { timeout: 20_000 });
    await expect(again.getByRole('button', { name: 'Set up authenticator' })).toHaveCount(0);
    await again.getByLabel('Six-digit code').fill('000000');
    await again.getByRole('button', { name: 'Verify and open admin' }).click();
    await expect(again.getByText('That code did not work')).toBeVisible({ timeout: 15_000 });
    await again.getByLabel('Six-digit code').fill(totp(superSecret, Date.now() + 30_000));
    await again.getByRole('button', { name: 'Verify and open admin' }).click();
    await expect(again).toHaveURL(/\/admin$/, { timeout: 20_000 });

    await again.goto('/admin/audit');
    await expect(again.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    // Entries are sentences that name who did what, not codes.
    await again.locator('#audit-topic').selectOption('attendance');
    await again.getByRole('button', { name: 'Show' }).click();
    await expect(again).toHaveURL(/about=attendance/);
    await expect(again.getByText(`checked ${memberName} in by card.`).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(again.getByText('attendance.check_in')).toHaveCount(0);
    await expect(again.getByText('wrote a card for')).toHaveCount(0);
    await again.locator('#audit-topic').selectOption('cards');
    await again.getByRole('button', { name: 'Show' }).click();
    await expect(again.getByText(`wrote a card for ${memberName}.`).first()).toBeVisible({
      timeout: 15_000,
    });
    // Home shows the latest of them the same way, with the full log one click away.
    await again.goto('/admin');
    await expect(
      again.getByRole('list', { name: 'Recent actions' }).locator('li').first(),
    ).toContainText(/^(You|Someone|[A-Z]).+\./);
    await again.getByRole('link', { name: 'Full audit log' }).click();
    await expect(again).toHaveURL(/\/admin\/audit$/);

    const { data: rows } = await supabase()
      .from('audit_log')
      .select('action, target_id, reason, before, after')
      .order('created_at', { ascending: false })
      .limit(200);
    const serialized = JSON.stringify(rows);
    expect(serialized, 'no one-time link in the audit log').not.toContain('token_hash');
    expect(serialized, 'no card URL in the audit log').not.toContain('/c/');
    const recovery = rows?.find((row) => row.action === 'member.recovery_link_generated');
    expect(recovery?.target_id).toBe(memberAuthId);
  });

  test('member and admin pages fit a phone and stay reachable', async () => {
    const checkFit = async (page: Page, paths: string[]) => {
      await page.setViewportSize({ width: 375, height: 812 });
      for (const target of paths) {
        const response = await page.goto(target);
        expect(response?.status(), target).toBe(200);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${target} overflows at 375px`).toBeLessThanOrEqual(1);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    };
    await checkFit(memberPage, [
      '/member',
      '/member/activity',
      '/member/id',
      '/member/profile',
      '/member/privacy',
      '/member/rewards',
    ]);
    const { data: adminPrivate } = await supabase()
      .from('member_private')
      .select('member_id')
      .eq('email', people.admin.email)
      .single();
    const { data: adminMember } = await supabase()
      .from('members')
      .select('auth_user_id')
      .eq('id', adminPrivate?.member_id as string)
      .single();
    await checkFit(superPage, [
      '/admin',
      '/admin/users',
      '/admin/users?invite=1',
      `/admin/staff/${adminMember?.auth_user_id as string}`,
      '/admin/profile',
      '/admin/cards',
      '/admin/kiosk',
      '/admin/events',
      `/admin/events/${eventId}`,
      '/admin/rewards',
      `/admin/members/${memberId}`,
      '/admin/audit',
    ]);
    await checkFit(anonPage, ['/', '/events', `/events/${eventSlug}`, '/leaderboard', '/privacy']);
  });

  test('a superadmin deletes things for good, and the audit log keeps the record', async ({
    browser,
  }) => {
    const client = supabase();
    const auditCount = async () => {
      const { count } = await client.from('audit_log').select('id', { count: 'exact', head: true });
      return count ?? 0;
    };
    const auditBefore = await auditCount();
    // Every delete asks first, in a dialog that names what is about to go.
    const confirmDelete = async (title: string | RegExp, button = 'Yes, delete it for good') => {
      const dialog = superPage.getByRole('dialog');
      await expect(dialog).toContainText(title);
      await dialog.getByRole('button', { name: button }).click();
    };

    // A normal admin is not offered any of it.
    await adminPage.goto(`/admin/events/${eventId}`);
    await expect(adminPage.getByRole('heading', { name: eventName })).toBeVisible();
    await expect(adminPage.getByRole('button', { name: 'Delete for good' })).toHaveCount(0);
    await adminPage.goto('/admin/cards');
    await expect(adminPage.getByRole('heading', { name: 'Cards issued' })).toBeVisible();
    await expect(adminPage.getByRole('table').getByRole('row').nth(1)).toBeVisible();
    await expect(adminPage.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await adminPage.goto('/admin/rewards');
    await expect(adminPage.getByRole('list', { name: 'Recently handled' })).toBeVisible();
    await expect(adminPage.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);

    // An invitation goes with the unused account that was made for it.
    await invite(superPage, strayEmail);
    const { data: stray } = await client
      .from('member_invitations')
      .select('id, auth_user_id')
      .eq('email', strayEmail)
      .single();
    const strayAuthId = stray?.auth_user_id as string;
    fixtureAuthIds.add(strayAuthId);
    await superPage.goto('/admin/users');
    const strayRow = superPage.getByRole('row').filter({ hasText: strayEmail });
    await strayRow.getByRole('button', { name: 'Delete for good' }).click();
    await confirmDelete(`Delete the invitation for ${strayEmail} for good?`);
    await expect(superPage.getByText('Invitation deleted for good.')).toBeVisible({
      timeout: 15_000,
    });
    await expect(strayRow).toHaveCount(0);
    expect((await client.auth.admin.getUserById(strayAuthId)).data.user).toBeNull();
    fixtureAuthIds.delete(strayAuthId);

    // A handled reward request, then a reward.
    await superPage.goto('/admin/rewards');
    const handled = superPage.getByRole('list', { name: 'Recently handled' }).locator('li');
    const handledBefore = await handled.count();
    expect(handledBefore).toBeGreaterThan(0);
    await handled.first().getByRole('button', { name: 'Delete', exact: true }).click();
    await confirmDelete('Delete this request for good?');
    await expect(superPage.getByText('Request deleted for good.')).toBeVisible({ timeout: 15_000 });
    await expect(handled).toHaveCount(handledBefore - 1);

    const doomedReward = `WF ${stamp} Doomed`;
    const { data: reward } = await client
      .from('rewards')
      .insert({ name: doomedReward, description: 'Deleted by the suite', cost_points: 1 })
      .select('id')
      .single();
    await superPage.goto(`/admin/rewards/${reward?.id as string}`);
    await superPage.getByRole('button', { name: 'Delete for good' }).click();
    await confirmDelete(`Delete ${doomedReward} for good?`);
    await expect(superPage).toHaveURL(/\/admin\/rewards\?notice=/, { timeout: 15_000 });
    await expect(superPage.getByText('Reward deleted for good.')).toBeVisible();
    await expect(superPage.getByText(doomedReward)).toHaveCount(0);

    // A card record.
    const cardCount = async () => {
      const { count } = await client
        .from('card_credentials')
        .select('id', { count: 'exact', head: true });
      return count ?? 0;
    };
    const cardsBefore = await cardCount();
    await superPage.goto('/admin/cards');
    await superPage.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await confirmDelete(/Delete .+ card for good\?/);
    await expect(superPage.getByText('Card deleted for good.')).toBeVisible({ timeout: 15_000 });
    expect(await cardCount()).toBe(cardsBefore - 1);

    // An event goes with its sessions and attendance. What members earned stays.
    const balance = async () => {
      const { data } = await client
        .from('member_balances')
        .select('points, stars')
        .eq('member_id', memberId)
        .single();
      return data;
    };
    const balanceBefore = await balance();
    expect(balanceBefore?.stars).toBeGreaterThan(0);
    await superPage.goto(`/admin/events/${eventId}`);
    await superPage.getByRole('button', { name: 'Delete for good' }).click();
    await expect(superPage.getByRole('dialog')).toContainText(
      'Members keep the points they earned from it.',
    );
    await confirmDelete(`Delete ${eventName} for good?`);
    await expect(superPage).toHaveURL(/\/admin\/events\?notice=/, { timeout: 15_000 });
    await expect(superPage.getByText('Event deleted for good.')).toBeVisible();
    await expect(superPage.getByRole('link', { name: eventName })).toHaveCount(0);
    expect(await balance()).toEqual(balanceBefore);
    const { count: attendanceLeft } = await client
      .from('attendance_records')
      .select('id', { count: 'exact', head: true })
      .in('session_id', [mainSessionId, bonusSessionId]);
    expect(attendanceLeft).toBe(0);
    expect((await anonPage.goto(`/events/${eventSlug}`))?.status()).toBe(404);
    await memberPage.goto('/member/activity');
    await expect(memberPage.getByRole('heading', { name: 'Points history' })).toBeVisible();

    // A person goes with everything about them, and cannot sign in again.
    const { data: secondPrivate } = await client
      .from('member_private')
      .select('member_id')
      .eq('email', people.second.email)
      .single();
    const secondMemberId = secondPrivate?.member_id as string;
    const { data: secondMember } = await client
      .from('members')
      .select('auth_user_id, member_profiles(profile_slug)')
      .eq('id', secondMemberId)
      .single();
    const secondAuthId = secondMember?.auth_user_id as string;
    const secondSlug = (secondMember?.member_profiles as unknown as { profile_slug: string })
      .profile_slug;
    await superPage.goto(`/admin/members/${secondMemberId}`);
    await superPage.getByRole('button', { name: 'Delete for good' }).click();
    await confirmDelete("Delete Second Member's account for good?", 'Yes, delete the account');
    await expect(superPage).toHaveURL(/\/admin\/users\?notice=/, { timeout: 20_000 });
    await expect(superPage.getByText('Account deleted for good.')).toBeVisible();
    await expect(superPage.getByRole('row').filter({ hasText: people.second.email })).toHaveCount(
      0,
    );
    const { count: membersLeft } = await client
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('id', secondMemberId);
    expect(membersLeft).toBe(0);
    expect((await client.auth.admin.getUserById(secondAuthId)).data.user).toBeNull();
    const { data: photosLeft } = await client.storage
      .from('avatars')
      .list(`member/${secondAuthId}`);
    expect(photosLeft ?? []).toHaveLength(0);
    expect((await anonPage.goto(`/m/${secondSlug}`))?.status()).toBe(404);
    const gone = await newPage(browser, 'deleted member');
    await signIn(gone, people.second.email, people.second.password);
    await expect(gone.getByText('Email or password is incorrect')).toBeVisible({ timeout: 15_000 });

    // Each delete is in the audit log, by name for things and never for people.
    expect(await auditCount()).toBeGreaterThanOrEqual(auditBefore + 6);
    await superPage.goto('/admin/audit');
    await expect(superPage.getByText(`You deleted the event ${eventName} for good.`)).toBeVisible();
    await expect(
      superPage.getByText(`You deleted the reward ${doomedReward} for good.`),
    ).toBeVisible();
    await expect(superPage.getByText("You deleted a member's account for good.")).toBeVisible();
    await expect(superPage.getByText('You deleted an invitation for good.')).toBeVisible();
    await expect(superPage.getByText('Second Member')).toHaveCount(0);
    await expect(superPage.getByRole('button', { name: /delete/i })).toHaveCount(0);

    // And nothing deletes or rewrites the log itself, whatever key is used.
    const auditAfter = await auditCount();
    const { error: auditDelete } = await client.from('audit_log').delete().gt('id', 0);
    expect(auditDelete?.message).toContain('audit_log_is_permanent');
    const { error: auditEdit } = await client
      .from('audit_log')
      .update({ reason: 'rewritten' })
      .gt('id', 0);
    expect(auditEdit?.message).toContain('audit_log_is_permanent');
    expect(await auditCount()).toBe(auditAfter);
  });

  test('repeated bad passwords are slowed down', async ({ browser }) => {
    const page = await newPage(browser, 'rate limit');
    const email = `wf-locked-${stamp}@example.com`;
    let limited = false;
    // The limit is a fixed window, so a run can straddle a boundary and need more.
    for (let attempt = 0; attempt < 24 && !limited; attempt += 1) {
      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill('not-the-right-password-1');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(
        page.getByText(/Email or password is incorrect|Too many sign-in attempts/),
      ).toBeVisible({ timeout: 15_000 });
      limited = await page.getByText('Too many sign-in attempts').isVisible();
    }
    expect(limited).toBe(true);
  });

  test('no page hit a CSP violation or an uncaught error', () => {
    expect(browserProblems).toEqual([]);
  });
});
