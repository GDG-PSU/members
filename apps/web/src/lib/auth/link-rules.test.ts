import { describe, expect, it } from 'vitest';
import { inviteExpired, LINK_HOURS, LINK_NEXT, LINK_TOKEN, staffInviteExpiry } from './link-rules';

describe('link rules', () => {
  it('gives invitations 72 hours and password resets 48', () => {
    expect(LINK_HOURS).toEqual({ member_invite: 72, staff_invite: 72, recovery: 48 });
    // The database refuses anything longer than 72 hours.
    expect(Math.max(...Object.values(LINK_HOURS))).toBeLessThanOrEqual(72);
  });

  it('sends each kind of link to its own next step', () => {
    expect(LINK_NEXT.member_invite).toBe('/invite/accept');
    expect(LINK_NEXT.staff_invite).toBe('/account/password');
    expect(LINK_NEXT.recovery).toBe('/account/password');
  });

  it('accepts only a token of the size the app makes', () => {
    expect(LINK_TOKEN.test('a'.repeat(43))).toBe(true);
    expect(LINK_TOKEN.test('a'.repeat(42))).toBe(false);
    expect(LINK_TOKEN.test(`${'a'.repeat(42)}/`)).toBe(false);
  });

  it('treats an invitation as not accepted from the moment its link stops working', () => {
    const now = new Date('2026-11-08T12:00:00Z').getTime();
    expect(inviteExpired('2026-11-08T12:00:00Z', now)).toBe(true);
    expect(inviteExpired('2026-11-08T12:00:01Z', now)).toBe(false);
    expect(inviteExpired(null, now)).toBe(false);
  });

  it('dates an older organizer invitation 72 hours from when it was made', () => {
    expect(staffInviteExpiry('2026-11-05T12:00:00.000Z')).toBe('2026-11-08T12:00:00.000Z');
  });
});
