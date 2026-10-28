import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', 'apps/web/.env.local'], quiet: true });

const baseURL =
  process.env.E2E_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3100';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
  // Start the built app separately (`pnpm --filter @gdg/web start -p 3000`).
  // Public specs run anywhere. The authenticated admin spec uses the real
  // Supabase project only when NEXT_PUBLIC_SUPABASE_URL and
  // SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) are present, and it
  // removes every fixture account it creates.
});
