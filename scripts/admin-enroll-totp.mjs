#!/usr/bin/env node
/**
 * Enrolls the admin TOTP factor through the app's own /admin-mfa flow and
 * writes the manual setup key to a gitignored file for the operator to add to
 * their authenticator app. The secret is never printed to the terminal.
 *
 * Usage: node scripts/admin-enroll-totp.mjs [--credentials .local/gdg-admin-credentials.txt] [--out .local/gdg-admin-totp.txt]
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHmac } from 'node:crypto';
import { chromium } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function totp(secret, at = Date.now()) {
  const clean = secret.replace(/=+$/, '').toUpperCase();
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 secret.');
    value = ((value << 5) | index) & 0xffffffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

loadEnv({ path: ['.env.local', 'apps/web/.env.local'], quiet: true });

const { values } = parseArgs({
  options: {
    credentials: { type: 'string', default: '.local/gdg-admin-credentials.txt' },
    out: { type: 'string', default: '.local/gdg-admin-totp.txt' },
    'base-url': {
      type: 'string',
      default: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    },
  },
});

function readCredentials(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Credentials file not found: ${file}. Run pnpm db:bootstrap-admin first.`);
  }
  const text = fs.readFileSync(file, 'utf8');
  const email = text.match(/^\s*Admin:\s*(\S+)\s*$/im)?.[1];
  const password = text.match(/^\s*Password:\s*(.+?)\s*$/im)?.[1];
  if (!email || !password) {
    throw new Error(`Could not read "Admin:" and "Password:" lines from ${file}.`);
  }
  return { email, password };
}

const { email, password } = readCredentials(values.credentials);
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: values['base-url'] });
const page = await context.newPage();

try {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.waitForURL(/\/admin-mfa$/, { timeout: 20_000 });

  const setupButton = page.getByRole('button', { name: 'Set up authenticator' });
  if (!(await setupButton.isVisible().catch(() => false))) {
    const sixDigit = page.getByLabel('Six-digit code');
    if (await sixDigit.isVisible().catch(() => false)) {
      console.error(
        'This account already has a verified authenticator. Reset the factor in Supabase Auth before enrolling a new device.',
      );
      process.exitCode = 2;
    } else {
      console.error(
        `Expected the authenticator setup screen at ${values['base-url']}/admin-mfa, but landed on ${page.url()}. Is the account an admin?`,
      );
      process.exitCode = 3;
    }
  } else {
    await setupButton.click();
    const secretLocator = page.locator('code');
    await secretLocator.waitFor({ state: 'visible', timeout: 20_000 });
    const secret = ((await secretLocator.textContent()) ?? '').trim().toUpperCase();
    if (!/^[A-Z2-7]+=*$/.test(secret)) {
      throw new Error('The enrollment page did not expose a base32 manual key.');
    }

    await page.getByLabel('Six-digit code').fill(totp(secret));
    await page.getByRole('button', { name: 'Verify and open admin' }).click();
    await page.waitForURL(/\/admin$/, { timeout: 20_000 });

    const issuer = encodeURIComponent('GDG@PSU');
    const account = encodeURIComponent(email);
    const uri = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
    const outPath = path.resolve(values.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(
      outPath,
      [
        'GDG@PSU organizer authenticator',
        `Account: ${email}`,
        `Secret: ${secret}`,
        '',
        'Add this to your authenticator app with "enter a setup key" (time-based, SHA1, 6 digits, 30s),',
        'or import the URI below. Then delete this file.',
        '',
        uri,
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    fs.chmodSync(outPath, 0o600);
    console.log(`Enrolled the authenticator for ${email} and verified an AAL2 session.`);
    console.log(`Manual key written to ${values.out} (gitignored). It was not printed here.`);
    console.log('Add it to your authenticator app, sign in once to confirm, then delete the file.');
  }
} finally {
  await context.close();
  await browser.close();
}
