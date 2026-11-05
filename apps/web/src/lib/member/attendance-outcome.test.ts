import { describe, expect, it } from 'vitest';
import { attendanceOutcome, type AttendanceFacts } from './attendance-outcome';

const now = new Date('2026-11-05T18:00:00Z').getTime();
const base: AttendanceFacts = {
  state: 'completed',
  qualified: false,
  rewardPoints: 0,
  checkedOutAt: '2026-11-05T17:00:00Z',
  durationMinutes: 60,
  sessionReward: 20,
  minimumMinutes: 0,
  checkOutClosesAt: '2026-11-05T17:30:00Z',
};

describe('attendanceOutcome', () => {
  it('shows the points that were earned', () => {
    expect(attendanceOutcome({ ...base, qualified: true, rewardPoints: 20 }, now)).toEqual({
      earned: true,
      label: '+20 points',
      detail: null,
    });
  });

  it('says a session gives no points rather than calling it a failure', () => {
    expect(attendanceOutcome({ ...base, sessionReward: 0 }, now)).toMatchObject({
      earned: false,
      label: 'Attended',
    });
    expect(attendanceOutcome({ ...base, qualified: true, sessionReward: 0 }, now).label).toBe(
      'Attended',
    );
  });

  it('tells someone still at the event to check out', () => {
    const open = {
      ...base,
      state: 'checked_in',
      checkedOutAt: null,
      durationMinutes: null,
      checkOutClosesAt: '2026-11-05T19:00:00Z',
    };
    expect(attendanceOutcome(open, now)).toMatchObject({
      label: 'Checked in',
      detail: 'Check out before you leave to get your points.',
    });
  });

  it('explains a missed check-out once the window has closed', () => {
    const missed = { ...base, state: 'checked_in', checkedOutAt: null, durationMinutes: null };
    expect(attendanceOutcome(missed, now)).toMatchObject({
      label: 'No points',
      detail: 'You did not check out, so no points were given.',
    });
    // A session that could not be read counts as closed, never as still open.
    expect(attendanceOutcome({ ...missed, checkOutClosesAt: null }, now).label).toBe('No points');
  });

  it('explains a stay that was too short', () => {
    expect(
      attendanceOutcome({ ...base, durationMinutes: 12, minimumMinutes: 30 }, now).detail,
    ).toBe('You stayed 12 min and this session needs 30.');
  });

  it('explains a rejected check-in and a correction', () => {
    expect(attendanceOutcome({ ...base, state: 'rejected' }, now).detail).toBe(
      'This check-in was not accepted.',
    );
    expect(attendanceOutcome(base, now).detail).toBe('An organizer changed this record.');
  });
});
