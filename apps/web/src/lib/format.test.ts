import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatTime, newYorkInputToIso, pluralize } from './format';

describe('America/New_York conversions', () => {
  it('converts summer wall-clock input using EDT (-4)', () => {
    expect(newYorkInputToIso('2026-07-15T18:00')).toBe('2026-07-15T22:00:00.000Z');
  });

  it('converts winter wall-clock input using EST (-5)', () => {
    expect(newYorkInputToIso('2026-01-15T18:00')).toBe('2026-01-15T23:00:00.000Z');
  });

  it('handles the DST transition morning', () => {
    expect(newYorkInputToIso('2026-03-08T03:00')).toBe('2026-03-08T07:00:00.000Z');
  });

  it('rejects malformed input', () => {
    expect(() => newYorkInputToIso('not-a-date')).toThrow();
  });
});

describe('display formatting', () => {
  it('renders dates in the event timezone', () => {
    expect(formatDate('2026-07-15T02:00:00.000Z')).toBe('Jul 14, 2026');
    expect(formatDate(null)).toBe('—');
  });

  it('renders a date-time with a timezone label', () => {
    const formatted = formatDateTime('2026-01-15T23:00:00.000Z');
    expect(formatted).toContain('Jan 15');
    expect(formatted).toContain('EST');
  });

  it('renders a short time', () => {
    expect(formatTime('2026-01-15T23:00:00.000Z')).toBe('6:00 PM');
  });

  it('pluralizes counts', () => {
    expect(pluralize(1, 'point')).toBe('1 point');
    expect(pluralize(2, 'point')).toBe('2 points');
  });
});
