import { describe, expect, it } from 'vitest';
import { PHOTO_IDENTITY_WINDOW_HOURS, photoChangedWithin } from './identity';

const now = new Date('2026-10-29T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

describe('photoChangedWithin', () => {
  it('treats a photo changed inside the window as recent', () => {
    expect(photoChangedWithin(hoursAgo(1), now)).toBe(true);
    expect(photoChangedWithin(hoursAgo(PHOTO_IDENTITY_WINDOW_HOURS - 1), now)).toBe(true);
  });

  it('treats a photo changed outside the window as established', () => {
    expect(photoChangedWithin(hoursAgo(PHOTO_IDENTITY_WINDOW_HOURS + 1), now)).toBe(false);
    expect(photoChangedWithin(hoursAgo(24 * 30), now)).toBe(false);
  });

  it('includes the exact boundary', () => {
    expect(photoChangedWithin(hoursAgo(PHOTO_IDENTITY_WINDOW_HOURS), now)).toBe(true);
  });

  it('ignores missing or invalid timestamps', () => {
    expect(photoChangedWithin(null, now)).toBe(false);
    expect(photoChangedWithin(undefined, now)).toBe(false);
    expect(photoChangedWithin('not-a-date', now)).toBe(false);
  });
});
