import { expect, test } from '@playwright/test';
import { baseUrl, hasSupabaseAdminCredentials, loadTestEnv, siteOrigin } from './support/env';
import {
  createDisposableAdmin,
  deleteAdminFixture,
  deleteMemberFixture,
  serviceClient,
} from './support/supabase';
import { totp } from './support/totp';

loadTestEnv();

const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('admin invitation and member setup', () => {
  test.skip(
    !hasSupabaseAdminCredentials(),
    'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) to run the authenticated suite. A hosted test project also needs E2E_ALLOW_HOSTED_SUPABASE=yes.',
  );

  test('invitation link is generated, copied, accepted, and completes member setup', async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Authenticated flow runs once.');
    test.setTimeout(120_000);

    const origin = new URL(baseURL ?? baseUrl()).origin;
    test.skip(
      origin !== siteOrigin(),
      `Invitation links are issued for ${siteOrigin()}; start the app there or set E2E_BASE_URL to match.`,
    );

    const supabase = serviceClient();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const adminEmail = `e2e-admin-${stamp}@example.com`;
    const adminPassword = `E2e-Admin-${stamp}-9x`;
    const memberEmail = `e2e-member-${stamp}@example.com`;
    const memberPassword = `E2e-Member-${stamp}-7q`;
    const displayName = 'E2E Invitee';
    const paidSince = '2026-01-15';

    let adminUserId: string | null = null;
    let memberId: string | null = null;
    let invitationLink = '';
    let totpSecret = '';
    let cardUrl = '';
    let kioskEventId: string | null = null;
    let kioskSessionId: string | null = null;

    try {
      await test.step('create a disposable admin account', async () => {
        const admin = await createDisposableAdmin(supabase, {
          email: adminEmail,
          password: adminPassword,
        });
        adminUserId = admin.user.id;
      });

      await test.step('admin signs in and enrolls TOTP', async () => {
        await page.goto('/login');
        await page.getByLabel('Email').fill(adminEmail);
        await page.getByLabel('Password').fill(adminPassword);
        await page.getByRole('button', { name: 'Sign in' }).click();

        await expect(page).toHaveURL(/\/admin-mfa/, { timeout: 20_000 });
        const pendingWithoutMfa = await page.request.get('/api/admin/kiosk/pending');
        expect(pendingWithoutMfa.status()).toBe(403);
        await page.getByRole('button', { name: 'Set up authenticator' }).click();

        const secret = page.locator('code');
        await expect(secret).toBeVisible();
        totpSecret = (await secret.textContent())?.trim().toUpperCase() ?? '';
        expect(totpSecret).toMatch(/^[A-Z2-7]+=*$/);

        await page.getByLabel('Six-digit code').fill(totp(totpSecret));
        await page.getByRole('button', { name: 'Verify and open admin' }).click();
        await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
        const foreignOrigin = await page.request.post('/api/admin/kiosk/confirm', {
          headers: { origin: 'https://attacker.example' },
          data: { scanId: '00000000-0000-4000-8000-000000000000', action: 'reject' },
        });
        expect(foreignOrigin.status()).toBe(403);
      });

      await test.step('admin generates and copies an invitation link', async () => {
        await page.goto('/admin');
        await expect(page.getByRole('link', { name: 'Devices', exact: true })).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Users', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Audit', exact: true })).toHaveCount(0);

        await page.goto('/admin/users');
        await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
        await expect(page.getByRole('combobox', { name: /User type for/ })).toHaveCount(0);
        await page.goto('/admin/audit');
        await expect(page).toHaveURL(/\/admin\?notice=superadmin-required$/);

        await page.goto('/admin/devices');
        await expect(page).toHaveURL(/\/admin\/cards$/);
        await expect(page.getByRole('heading', { name: 'Cards', exact: true })).toBeVisible();

        await page.goto('/admin/invitations');
        await expect(
          page.getByRole('heading', { name: 'Invite an admin or superadmin' }),
        ).toHaveCount(0);
        const memberForm = page
          .locator('form')
          .filter({ has: page.getByLabel('Member since (paid date)') })
          .first();
        await memberForm.getByLabel('Email').fill(memberEmail);
        await memberForm.getByLabel('Member since (paid date)').fill(paidSince);
        await memberForm
          .getByLabel('Internal note')
          .fill('Created by the authenticated E2E suite.');
        await page.getByRole('button', { name: 'Generate invitation link' }).click();

        const ready = page.getByRole('status').filter({ hasText: 'Invitation link ready' });
        await expect(ready).toBeVisible({ timeout: 20_000 });
        await expect(ready).toContainText(memberEmail);

        invitationLink = await page.getByLabel('One-time sign-in link').inputValue();
        expect(new URL(invitationLink).origin).toBe(origin);
        expect(new URL(invitationLink).pathname).toBe('/auth/confirm');
        expect(new URL(invitationLink).searchParams.get('next')).toBe('/invite/accept');

        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
        await page.getByRole('button', { name: 'Copy link' }).click();
        await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(invitationLink);

        await expect(page.getByText(memberEmail).first()).toBeVisible();

        await page.goto('/admin/users');
        await expect(page.getByText(memberEmail).first()).toBeVisible();
        await expect(page.getByText('Invite stage').first()).toBeVisible();
        await expect(page.getByRole('combobox', { name: /User type for/ })).toHaveCount(0);
      });
      const memberContext = await browser.newContext({ baseURL: origin });
      const memberPage = await memberContext.newPage();

      try {
        await test.step('member opens the link and completes setup', async () => {
          await memberPage.goto(invitationLink);
          await memberPage.getByRole('button', { name: 'Continue', exact: true }).click();
          await expect(memberPage).toHaveURL(/\/invite\/accept$/, { timeout: 30_000 });
          await expect(memberPage.getByRole('heading', { name: 'Make it yours' })).toBeVisible();
          await expect(memberPage.getByText(memberEmail)).toBeVisible();

          await expect(memberPage.getByLabel('Show my email on my public profile')).toBeChecked();
          await memberPage.getByLabel('Show my email on my public profile').uncheck();
          await memberPage.getByLabel('Make my profile public').uncheck();
          await memberPage.getByLabel('Display name').fill(displayName);
          await memberPage.getByLabel('Short bio').fill('Created by the authenticated E2E suite.');
          await memberPage.locator('input[type="file"]').setInputFiles({
            name: 'avatar.png',
            mimeType: 'image/png',
            buffer: PHOTO,
          });
          await memberPage.locator('input[name="password"]').fill(memberPassword);
          await memberPage.locator('input[name="confirmPassword"]').fill(memberPassword);
          await memberPage
            .locator('label')
            .filter({ hasText: 'I confirm this is a clear, current photo of my face' })
            .click();
          await expect(memberPage.locator('input[name="photoAttestation"]')).toBeChecked();
          await memberPage
            .locator('label')
            .filter({ hasText: 'I understand my privacy choices above' })
            .click();
          await expect(memberPage.locator('input[name="acceptTerms"]')).toBeChecked();
          await memberPage.getByRole('button', { name: 'Create my profile' }).click();

          await expect(memberPage).toHaveURL(/\/member\?welcome=1/, { timeout: 30_000 });
          await expect(memberPage.getByText(/You.re in, E2E/)).toBeVisible();
          await expect(memberPage.getByRole('heading', { name: displayName })).toBeVisible();
        });

        await test.step('database reflects the accepted invitation and active member', async () => {
          const { data: invitation, error: invitationError } = await supabase
            .from('member_invitations')
            .select('auth_user_id, status, accepted_at')
            .eq('email', memberEmail)
            .single();
          expect(invitationError).toBeNull();
          expect(invitation?.status).toBe('accepted');
          expect(invitation?.accepted_at).toBeTruthy();

          const memberUserId = invitation?.auth_user_id as string;
          const { data: member, error: memberError } = await supabase
            .from('members')
            .select('id, status, member_since')
            .eq('auth_user_id', memberUserId)
            .single();
          expect(memberError).toBeNull();
          memberId = member?.id as string;
          expect(member?.status).toBe('active');
          expect(member?.member_since).toBe(paidSince);

          const { data: profile } = await supabase
            .from('member_profiles')
            .select('display_name, photo_path, profile_slug, show_email, public_profile')
            .eq('member_id', member?.id)
            .single();
          expect(profile?.display_name).toBe(displayName);
          expect(profile?.show_email).toBe(false);
          expect(profile?.public_profile).toBe(false);
          expect(profile?.photo_path).toMatch(new RegExp(`^member/${memberUserId}/`));

          const { data: privateRow } = await supabase
            .from('member_private')
            .select('email')
            .eq('member_id', member?.id)
            .single();
          expect(privateRow?.email).toBe(memberEmail);

          const photoUrl = `/api/profile-photo/${profile?.profile_slug}`;
          const anonymous = await browser.newContext({ baseURL: origin });
          try {
            expect((await anonymous.request.get(photoUrl)).status()).toBe(404);
            const { error: publishError } = await supabase
              .from('member_profiles')
              .update({ public_profile: true })
              .eq('member_id', member?.id);
            expect(publishError).toBeNull();
            expect((await anonymous.request.get(photoUrl)).status()).toBe(200);
            const { error: hideError } = await supabase
              .from('member_profiles')
              .update({ show_photo: false })
              .eq('member_id', member?.id);
            expect(hideError).toBeNull();
            expect((await anonymous.request.get(photoUrl)).status()).toBe(404);
            expect((await memberContext.request.get(photoUrl)).status()).toBe(200);
            expect((await page.request.get(photoUrl)).status()).toBe(200);
            const { error: privateError } = await supabase
              .from('member_profiles')
              .update({ public_profile: false, show_photo: true, show_email: true })
              .eq('member_id', member?.id);
            expect(privateError).toBeNull();
            expect((await anonymous.request.get(photoUrl)).status()).toBe(404);
            const { data: publicProfile } = await supabase
              .from('public_profiles')
              .select('email')
              .eq('slug', profile?.profile_slug)
              .maybeSingle();
            expect(publicProfile).toBeNull();
          } finally {
            await anonymous.close();
          }
        });

        await test.step('admin prepares, activates and records a USB card', async () => {
          expect(memberId).toBeTruthy();
          await page.goto('/admin/cards');
          await expect(page.getByRole('heading', { name: 'Cards', exact: true })).toBeVisible();

          const memberSelect = page.locator('#usb-member');
          const option = memberSelect.locator('option', { hasText: displayName }).first();
          const optionValue = await option.getAttribute('value');
          expect(optionValue).toBeTruthy();
          await memberSelect.selectOption(optionValue as string);
          await page.getByRole('button', { name: 'Prepare card' }).click();

          await expect(page.getByText(`Pending card for ${displayName}`)).toBeVisible({
            timeout: 20_000,
          });
          cardUrl = await page.getByLabel('Card URL').inputValue();
          expect(new URL(cardUrl).origin).toBe(origin);
          expect(new URL(cardUrl).pathname).toMatch(/^\/c\/[A-Za-z0-9_-]{43}$/);

          const activation = page.getByText(
            'I verified the URL was written and the read-back matches.',
          );
          await activation.click();
          await page.getByRole('button', { name: 'Activate written card' }).click();
          await expect(page.getByRole('button', { name: 'Card activated' })).toBeVisible({
            timeout: 20_000,
          });

          const { data: card } = await supabase
            .from('card_credentials')
            .select('status, issued_at')
            .eq('member_id', memberId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          expect(card?.status).toBe('active');
          expect(card?.issued_at).toBeTruthy();
        });

        await test.step('USB writer and kiosk read cards and confirm attendance', async () => {
          expect(memberId).toBeTruthy();
          expect(cardUrl).toBeTruthy();

          const now = Date.now();
          const startsAt = new Date(now - 60 * 60_000).toISOString();
          const endsAt = new Date(now + 2 * 60 * 60_000).toISOString();
          const { data: event, error: eventError } = await supabase
            .from('events')
            .insert({
              name: 'E2E Kiosk Event',
              slug: `e2e-kiosk-${stamp}`,
              summary: 'Fixture for the USB kiosk flow.',
              location: 'Test room',
              starts_at: startsAt,
              ends_at: endsAt,
              status: 'published',
              is_public: false,
            })
            .select('id')
            .single();
          expect(eventError).toBeNull();
          kioskEventId = event?.id as string;

          const { data: session, error: sessionError } = await supabase
            .from('event_sessions')
            .insert({
              event_id: kioskEventId,
              name: 'Kiosk session',
              kind: 'main',
              starts_at: startsAt,
              ends_at: endsAt,
              check_in_opens_at: startsAt,
              check_in_closes_at: new Date(now + 60 * 60_000).toISOString(),
              check_out_opens_at: startsAt,
              check_out_closes_at: endsAt,
              minimum_duration_minutes: 0,
              reward_points: 5,
              is_enabled: true,
            })
            .select('id')
            .single();
          expect(sessionError).toBeNull();
          kioskSessionId = session?.id as string;

          await page.addInitScript(
            ({ cardUrl: fixtureCardUrl }) => {
              const encoder = new TextEncoder();
              const decoder = new TextDecoder();
              let readAttempts = 0;
              let writeAttempts = 0;
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
                      const text = decoder.decode(chunk);
                      for (const line of text.split('\n')) {
                        if (!line.trim()) continue;
                        const command = JSON.parse(line) as { id: number; cmd: string };
                        if (command.cmd === 'nfc.read') readAttempts += 1;
                        if (command.cmd === 'nfc.write') writeAttempts += 1;
                        const payload =
                          command.cmd === 'info'
                            ? {
                                id: command.id,
                                ok: true,
                                result: {
                                  protocol: 2,
                                  firmware: 'test',
                                  deviceId: 'esp32-test',
                                  chipId: 'test',
                                  nfcReady: true,
                                  nfcFirmware: 0x32010607,
                                  uptimeMs: 1,
                                },
                              }
                            : command.cmd === 'nfc.read' &&
                                (readAttempts === 1 ||
                                  (window as unknown as { __lifted?: boolean }).__lifted)
                              ? { id: command.id, ok: false, error: 'no_card' }
                              : command.cmd === 'nfc.read'
                                ? { id: command.id, ok: true, result: { uri: fixtureCardUrl } }
                                : command.cmd === 'nfc.write' && writeAttempts === 1
                                  ? { id: command.id, ok: false, error: 'no_card' }
                                  : { id: command.id, ok: true, result: {} };
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
            },
            { cardUrl },
          );

          await page.goto('/admin/cards');
          await expect(page.getByRole('heading', { name: 'Cards', exact: true })).toBeVisible();
          await page.getByRole('button', { name: 'Connect lane' }).click();
          await expect(page.getByText('Connected.')).toBeVisible({ timeout: 15_000 });

          await page.getByRole('button', { name: 'Read card' }).click();
          await expect(page.getByText('Card read.')).toBeVisible({ timeout: 10_000 });
          await expect(page.locator('p.break-all')).toHaveText(cardUrl);

          await page.getByLabel('NDEF URI').fill(cardUrl);
          await page.getByRole('button', { name: 'Write and verify' }).click();
          await expect(page.getByText('Write completed and read back.')).toBeVisible({
            timeout: 10_000,
          });

          await page.goto('/admin/kiosk');
          await expect(page.getByRole('heading', { name: 'Kiosk' })).toBeVisible();
          await page.locator('#kiosk-session').selectOption(kioskSessionId as string);
          // The reader is always on: the card is read without another click, after
          // the empty first read shows the kiosk keeps waiting.
          await page.getByRole('button', { name: 'Connect reader' }).click();
          await expect(page.getByRole('heading', { name: displayName })).toBeVisible({
            timeout: 20_000,
          });

          const { data: beforeConfirm } = await supabase
            .from('attendance_records')
            .select('id')
            .eq('member_id', memberId)
            .eq('session_id', kioskSessionId);
          expect(beforeConfirm).toHaveLength(0);

          const identityCheck = page.getByLabel("I checked this member's PSU ID");
          if (await identityCheck.isVisible().catch(() => false)) {
            await identityCheck.check();
          }
          await page.getByRole('button', { name: 'Confirm check-in' }).click();
          await expect(page.getByText(`${displayName} checked in.`)).toBeVisible({
            timeout: 20_000,
          });

          const { data: checkedIn } = await supabase
            .from('attendance_records')
            .select('state, checked_in_at')
            .eq('member_id', memberId)
            .eq('session_id', kioskSessionId)
            .single();
          expect(checkedIn?.state).toBe('checked_in');
          expect(checkedIn?.checked_in_at).toBeTruthy();

          // The card has to leave the reader before it is read again.
          await expect(page.getByText('Lift the card off the reader').first()).toBeVisible();
          await page.evaluate(() => {
            (window as unknown as { __lifted: boolean }).__lifted = true;
          });
          await expect(page.getByText('Waiting for a card')).toBeVisible({ timeout: 15_000 });
          await page.evaluate(() => {
            (window as unknown as { __lifted: boolean }).__lifted = false;
          });
          await expect(page.getByRole('heading', { name: displayName })).toBeVisible({
            timeout: 20_000,
          });
          if (await identityCheck.isVisible().catch(() => false)) {
            await identityCheck.check();
          }
          await page.getByRole('button', { name: 'Confirm check-out' }).click();
          await expect(page.getByText(`${displayName} checked out.`)).toBeVisible({
            timeout: 20_000,
          });

          const { data: checkedOut } = await supabase
            .from('attendance_records')
            .select('state, qualified, reward_points, checked_out_at')
            .eq('member_id', memberId)
            .eq('session_id', kioskSessionId)
            .single();
          expect(checkedOut?.state).toBe('completed');
          expect(checkedOut?.checked_out_at).toBeTruthy();
          expect(checkedOut?.reward_points).toBe(5);
        });
      } finally {
        await memberContext.close();
      }
    } finally {
      const { data: invitation } = await supabase
        .from('member_invitations')
        .select('auth_user_id')
        .eq('email', memberEmail)
        .maybeSingle();

      const invitedUserId = invitation?.auth_user_id as string | null;
      if (invitedUserId) {
        await deleteMemberFixture(supabase, invitedUserId).catch((error) => {
          console.warn('Could not delete the member fixture:', error);
        });
      }
      if (kioskEventId) {
        try {
          const { error } = await supabase.from('events').delete().eq('id', kioskEventId);
          if (error) {
            console.warn('Could not delete the kiosk event fixture:', error);
          }
        } catch (error) {
          console.warn('Could not delete the kiosk event fixture:', error);
        }
      }
      await supabase.from('member_invitations').delete().eq('email', memberEmail);
      if (adminUserId) {
        await deleteAdminFixture(supabase, adminUserId).catch((error) => {
          console.warn('Could not delete the admin fixture:', error);
        });
      }
    }
  });

  test('superadmin controls staff access and invite acceptance', async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Authenticated flow runs once.');
    test.setTimeout(120_000);

    const origin = new URL(baseURL ?? baseUrl()).origin;
    test.skip(
      origin !== siteOrigin(),
      `Invitation links are issued for ${siteOrigin()}; start the app there or set E2E_BASE_URL to match.`,
    );

    const supabase = serviceClient();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const superEmail = `e2e-super-${stamp}@example.com`;
    const superPassword = `E2e-Super-${stamp}-4k`;
    let superUserId: string | null = null;
    let invitedEmail = '';
    let invitedUserId: string | null = null;

    async function findInvitedUserId(email: string): Promise<string | null> {
      const { data, error } = await supabase
        .from('audit_log')
        .select('target_id')
        .eq('action', 'admin.invited')
        .eq('after->>email', email)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Could not find the invited user: ${error.message}`);
      return (data?.target_id as string | null) ?? null;
    }

    try {
      await test.step('create a disposable superadmin account', async () => {
        const created = await createDisposableAdmin(supabase, {
          email: superEmail,
          password: superPassword,
          role: 'superadmin',
        });
        superUserId = created.user.id;
      });

      await test.step('superadmin signs in and enrolls TOTP', async () => {
        await page.goto('/login');
        await page.getByLabel('Email').fill(superEmail);
        await page.getByLabel('Password').fill(superPassword);
        await page.getByRole('button', { name: 'Sign in' }).click();

        await expect(page).toHaveURL(/\/admin-mfa/, { timeout: 20_000 });
        await page.getByRole('button', { name: 'Set up authenticator' }).click();
        const secret = page.locator('code');
        await expect(secret).toBeVisible();
        const totpSecret = (await secret.textContent())?.trim().toUpperCase() ?? '';
        await page.getByLabel('Six-digit code').fill(totp(totpSecret));
        await page.getByRole('button', { name: 'Verify and open admin' }).click();
        await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
      });

      await test.step('superadmin-only navigation and pages', async () => {
        await page.goto('/admin');
        await expect(page.getByRole('link', { name: 'Users', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Audit', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Devices', exact: true })).toHaveCount(0);

        await page.goto('/admin/users');
        await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
        await expect(page.getByText(superEmail).first()).toBeVisible();
        await expect(page.getByText('Superadmin', { exact: true }).first()).toBeVisible();

        await page.goto('/admin/invitations');
        await expect(
          page.getByRole('heading', { name: 'Invite an admin or superadmin' }),
        ).toBeVisible();
        await expect(page.getByLabel('Role')).toBeVisible();

        await page.goto('/admin/audit');
        await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
      });

      await test.step('staff invite stays pending until the password step', async () => {
        invitedEmail = `e2e-invited-${stamp}@example.com`;
        const invitedPassword = `E2e-Invited-${stamp}-8z`;

        await page.goto('/admin/invitations');
        const inviteForm = page.locator('form').filter({ has: page.getByLabel('Role') });
        await inviteForm.getByLabel('Email').fill(invitedEmail);
        await inviteForm.getByLabel('Role').selectOption('admin');
        await inviteForm.getByRole('button', { name: 'Generate staff invite link' }).click();

        const ready = page.getByRole('status').filter({ hasText: 'Admin invite link ready' });
        await expect(ready).toBeVisible({ timeout: 20_000 });
        await expect(ready).toContainText(invitedEmail);
        const linkField = page.getByLabel('One-time sign-in link');
        const lostLink = await linkField.inputValue();

        // A lost or burned link can be replaced for the same person.
        await inviteForm.getByLabel('Email').fill(invitedEmail);
        await inviteForm.getByLabel('Role').selectOption('admin');
        await inviteForm.getByRole('button', { name: 'Generate staff invite link' }).click();
        await expect(linkField).not.toHaveValue(lostLink, { timeout: 20_000 });

        const inviteLink = await linkField.inputValue();
        expect(new URL(inviteLink).origin).toBe(origin);
        expect(new URL(inviteLink).pathname).toBe('/auth/confirm');
        expect(new URL(inviteLink).searchParams.get('next')).toBe('/account/password');

        invitedUserId = await findInvitedUserId(invitedEmail);
        if (!invitedUserId) throw new Error('The staff invite audit entry was not found.');

        await page.goto('/admin/users');
        const pendingRow = page.getByRole('row').filter({ hasText: invitedEmail });
        await expect(pendingRow).toBeVisible();
        await expect(pendingRow.getByText('Invited', { exact: true })).toBeVisible();
        await expect(pendingRow.getByText('Invite pending', { exact: true })).toHaveCount(0);

        const inviteeContext = await browser.newContext({ baseURL: origin });
        try {
          const inviteePage = await inviteeContext.newPage();
          await inviteePage.goto(inviteLink);
          await inviteePage.getByRole('button', { name: 'Continue', exact: true }).click();
          await expect(inviteePage).toHaveURL(/\/account\/password$/, { timeout: 30_000 });

          // Using the link creates a session before the password is set. The
          // badge must remain until the password step is actually completed.
          await page.goto('/admin/users');
          const stillPendingRow = page.getByRole('row').filter({ hasText: invitedEmail });
          await expect(stillPendingRow).toBeVisible();
          await expect(stillPendingRow.getByText('Invited', { exact: true })).toBeVisible();

          await inviteePage.getByLabel('New password', { exact: true }).fill(invitedPassword);
          await inviteePage
            .getByLabel('Confirm new password', { exact: true })
            .fill(invitedPassword);
          await inviteePage.getByRole('button', { name: 'Set new password' }).click();
          await expect(inviteePage).toHaveURL(/\/admin-mfa$/, { timeout: 30_000 });

          // After the authenticator comes the profile their card will open. No
          // admin page is reachable until it exists.
          await inviteePage.getByRole('button', { name: 'Set up authenticator' }).click();
          const inviteeSecret = inviteePage.locator('code');
          await expect(inviteeSecret).toBeVisible();
          await inviteePage
            .getByLabel('Six-digit code')
            .fill(totp(((await inviteeSecret.textContent()) ?? '').trim().toUpperCase()));
          await inviteePage.getByRole('button', { name: 'Verify and open admin' }).click();
          await expect(inviteePage).toHaveURL(/\/admin-setup$/, { timeout: 30_000 });
          await inviteePage.goto('/admin/events');
          await expect(inviteePage).toHaveURL(/\/admin-setup$/);

          await inviteePage.getByLabel('Your name').fill('Invited Organizer');
          await inviteePage.getByRole('button', { name: 'Save and continue' }).click();
          await expect(inviteePage.getByText('Add a photo for your profile.')).toBeVisible({
            timeout: 15_000,
          });
          await expect(inviteePage.getByLabel('Your name')).toHaveValue('Invited Organizer');

          await inviteePage.locator('input[type="file"]').setInputFiles({
            name: 'organizer.png',
            mimeType: 'image/png',
            buffer: Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
              'base64',
            ),
          });
          await inviteePage.getByRole('button', { name: 'Save and continue' }).click();
          await expect(inviteePage).toHaveURL(/\/admin\/profile/, { timeout: 30_000 });
          await expect(inviteePage.getByText('Your profile is ready.')).toBeVisible();

          const { data: organizer } = await supabase
            .from('members')
            .select('kind, status, member_profiles(profile_slug, display_name, photo_path)')
            .eq('auth_user_id', invitedUserId)
            .single();
          const organizerProfile = organizer?.member_profiles as unknown as {
            profile_slug: string;
            display_name: string;
            photo_path: string | null;
          };
          expect(organizer).toMatchObject({ kind: 'organizer', status: 'active' });
          expect(organizerProfile.display_name).toBe('Invited Organizer');
          expect(organizerProfile.photo_path).toBeTruthy();

          // Their public page is an organizer's, with no points on it.
          await inviteePage.goto(`/m/${organizerProfile.profile_slug}`);
          await expect(
            inviteePage.getByRole('heading', { name: 'Invited Organizer' }),
          ).toBeVisible();
          await expect(inviteePage.getByText('Organizer', { exact: true })).toBeVisible();
          await expect(inviteePage.getByText('Lifetime stars')).toHaveCount(0);

          await inviteePage.goto('/admin');
          await expect(inviteePage).toHaveURL(/\/admin$/);
        } finally {
          await inviteeContext.close();
        }

        const { data: passwordAudit, error: passwordAuditError } = await supabase
          .from('audit_log')
          .select('id')
          .eq('action', 'auth.password_updated')
          .eq('target_id', invitedUserId)
          .limit(1)
          .maybeSingle();
        expect(passwordAuditError).toBeNull();
        expect(passwordAudit).not.toBeNull();

        await page.goto('/admin/users');
        const acceptedRow = page.getByRole('row').filter({ hasText: invitedEmail });
        await expect(acceptedRow).toBeVisible();
        await expect(acceptedRow.getByText('Invited', { exact: true })).toHaveCount(0);
      });
    } finally {
      if (invitedEmail && !invitedUserId) {
        invitedUserId = await findInvitedUserId(invitedEmail).catch(() => null);
      }
      if (invitedUserId) {
        await deleteAdminFixture(supabase, invitedUserId).catch((error) => {
          console.warn('Could not delete the invited admin fixture:', error);
        });
      }
      if (superUserId) {
        await deleteAdminFixture(supabase, superUserId).catch((error) => {
          console.warn('Could not delete the superadmin fixture:', error);
        });
      }
    }
  });
});
