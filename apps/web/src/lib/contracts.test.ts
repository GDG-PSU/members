import { describe, expect, it } from 'vitest';
import {
  defaultVisibility,
  deviceScanSchema,
  leaderboardQuerySchema,
  newPasswordSchema,
  profileUpdateSchema,
  visibilitySchema,
} from '@gdg/contracts';

describe('contracts', () => {
  it('defaults email and profiles to public', () => {
    expect(defaultVisibility.publicProfile).toBe(true);
    expect(defaultVisibility.showEmail).toBe(true);
    expect(visibilitySchema.safeParse(defaultVisibility).success).toBe(true);
  });

  it('accepts https links and rejects javascript/data schemes', () => {
    const base = { displayName: 'Test Member', about: '' };
    expect(
      profileUpdateSchema.safeParse({
        ...base,
        links: [{ label: 'GitHub', url: 'https://github.com/example' }],
      }).success,
    ).toBe(true);

    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>',
      'http://insecure.example',
    ]) {
      expect(
        profileUpdateSchema.safeParse({ ...base, links: [{ label: 'Bad', url }] }).success,
      ).toBe(false);
    }
  });

  it('caps link lists at six entries', () => {
    const links = Array.from({ length: 7 }, (_, index) => ({
      label: `Link ${index}`,
      url: `https://example.com/${index}`,
    }));
    expect(profileUpdateSchema.safeParse({ displayName: 'Test', about: '', links }).success).toBe(
      false,
    );
  });

  it('validates device scan tokens and idempotency keys', () => {
    const valid = {
      cardToken: 'A'.repeat(43),
      idempotencyKey: 'scan-key-123456',
      firmwareVersion: '1.0.0',
    };
    expect(deviceScanSchema.safeParse(valid).success).toBe(true);
    expect(deviceScanSchema.safeParse({ ...valid, cardToken: 'short' }).success).toBe(false);
    expect(deviceScanSchema.safeParse({ ...valid, cardToken: `${'A'.repeat(43)}!` }).success).toBe(
      false,
    );
    expect(deviceScanSchema.safeParse({ ...valid, idempotencyKey: 'x' }).success).toBe(false);
  });

  it('requires a long password with a letter and a number', () => {
    expect(newPasswordSchema.safeParse('correct-horse-7').success).toBe(true);
    expect(newPasswordSchema.safeParse('short-1').success).toBe(false);
    expect(newPasswordSchema.safeParse('no-digits-in-this-one').success).toBe(false);
    expect(newPasswordSchema.safeParse('123456789012345').success).toBe(false);
    expect(newPasswordSchema.safeParse(`a1${'x'.repeat(127)}`).success).toBe(false);
  });

  it('bounds leaderboard pagination', () => {
    expect(leaderboardQuerySchema.parse({})).toEqual({ limit: 25, offset: 0 });
    expect(leaderboardQuerySchema.parse({ limit: '10', offset: '5' })).toEqual({
      limit: 10,
      offset: 5,
    });
    expect(leaderboardQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(leaderboardQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
  });
});
