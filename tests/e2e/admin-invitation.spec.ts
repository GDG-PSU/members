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
    'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) to run the authenticated suite.',
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
    let invitationLink = '';
    let totpSecret = '';

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
        await page.goto('/admin/invitations');
        await page.getByLabel('Email').fill(memberEmail);
        await page.getByLabel('Member since (paid date)').fill(paidSince);
        await page.getByLabel('Internal note').fill('Created by the authenticated E2E suite.');
        await page.getByRole('button', { name: 'Generate invitation link' }).click();

        const ready = page.getByRole('status').filter({ hasText: 'Invitation link ready' });
        await expect(ready).toBeVisible({ timeout: 20_000 });
        await expect(ready).toContainText(memberEmail);

        invitationLink = await page
          .getByLabel('One-time sign-in link')
          .locator('textarea:not([aria-hidden="true"])')
          .inputValue();
        expect(new URL(invitationLink).origin).toBe(
          new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin,
        );
        expect(new URL(invitationLink).pathname).toBe('/auth/v1/verify');

        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
        await page.getByRole('button', { name: 'Copy link' }).click();
        await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(invitationLink);

        await expect(page.getByText(memberEmail).first()).toBeVisible();
      });
      const memberContext = await browser.newContext({ baseURL: origin });
      const memberPage = await memberContext.newPage();

      try {
        await test.step('member opens the link and completes setup', async () => {
          await memberPage.goto(invitationLink);
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
          await memberPage.locator('input[name="acceptTerms"]').check({ force: true });
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
      await supabase.from('member_invitations').delete().eq('email', memberEmail);
      if (adminUserId) {
        await deleteAdminFixture(supabase, adminUserId).catch((error) => {
          console.warn('Could not delete the admin fixture:', error);
        });
      }
    }
  });
});
