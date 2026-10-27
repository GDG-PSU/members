import { expect, test } from '@playwright/test';

test.describe('public experience', () => {
  test('home renders the membership story and primary actions', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Build things');
    await expect(page.getByRole('link', { name: /see what's next/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /member sign in/i }).first()).toBeVisible();
    await expect(page.getByText(/this semester.s leaders/i)).toBeVisible();
  });

  test('leaderboard is reachable and has an accessible table or empty state', async ({ page }) => {
    const response = await page.goto('/leaderboard');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'The leaderboard' })).toBeVisible();
    const table = page.locator('table');
    const empty = page.getByText(/no public rankings yet/i);
    expect((await table.count()) + (await empty.count())).toBeGreaterThan(0);
  });

  test('events page renders without horizontal overflow at mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/events');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Come build with us');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('theme toggle exposes system, light and dark choices', async ({ page }) => {
    await page.goto('/');
    const group = page.getByRole('group', { name: /color theme/i });
    await expect(group).toBeVisible();
    await expect(group.getByRole('button', { name: /light theme/i })).toBeVisible();
    await group.getByRole('button', { name: /dark theme/i }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('private member routes redirect anonymous visitors to login', async ({ page }) => {
    await page.goto('/member');
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });

  test('unknown card links land on a neutral unavailable page', async ({ page }) => {
    await page.goto('/c/not-a-valid-token');
    await expect(page).toHaveURL(/card-unavailable/);
    await expect(page.getByRole('heading', { name: /not active/i })).toBeVisible();
  });

  test('device middleware rejects unsigned requests', async ({ request }) => {
    const response = await request.post('/api/device/v1/heartbeat', { data: {} });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('device_unauthorized');
    expect(body.error.requestId).toBeTruthy();
  });

  test('public APIs return explicit projections only', async ({ request }) => {
    const response = await request.get('/api/public/leaderboard');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.entries)).toBe(true);
    for (const entry of body.entries) {
      expect(Object.keys(entry).sort()).toEqual(
        ['displayName', 'memberNumber', 'photoUrl', 'points', 'rank', 'slug'].sort(),
      );
      expect(entry.email).toBeUndefined();
    }
  });
});
