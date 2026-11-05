import { describe, expect, it } from 'vitest';
import {
  describeAttendanceRule,
  eventStage,
  rulesFromWindows,
  sessionWindows,
  slugifyEventName,
} from './attendance-rules';

// 6:00 PM to 8:00 PM Eastern on a winter date (UTC-5).
const START = '2026-12-01T23:00:00.000Z';
const END = '2026-12-02T01:00:00.000Z';

describe('sessionWindows', () => {
  it('turns the two rules into the four stored times', () => {
    expect(sessionWindows(START, END, '30', '15')).toEqual({
      checkInOpensAt: '2026-12-01T22:30:00.000Z',
      checkInClosesAt: '2026-12-01T23:30:00.000Z',
      checkOutOpensAt: '2026-12-02T00:45:00.000Z',
      checkOutClosesAt: '2026-12-02T02:00:00.000Z',
    });
  });

  it('lets people come and go at any time when asked to', () => {
    const windows = sessionWindows(START, END, 'end', 'start');
    expect(windows.checkInClosesAt).toBe(END);
    expect(windows.checkOutOpensAt).toBe(START);
  });

  it('caps a rule that is longer than the session', () => {
    const shortEnd = '2026-12-01T23:20:00.000Z';
    const windows = sessionWindows(START, shortEnd, '60', '30');
    expect(windows.checkInClosesAt).toBe(shortEnd);
    expect(windows.checkOutOpensAt).toBe(START);
  });
});

describe('rulesFromWindows', () => {
  it('recovers the options a session was saved with', () => {
    for (const arriveBy of ['15', '30', '45', '60', 'end'] as const) {
      for (const leaveFrom of ['0', '15', '30', 'start'] as const) {
        const windows = sessionWindows(START, END, arriveBy, leaveFrom);
        expect(rulesFromWindows({ startsAt: START, endsAt: END, ...windows })).toEqual({
          arriveBy,
          leaveFrom,
        });
      }
    }
  });

  it('keeps hand-set times that match no option', () => {
    expect(
      rulesFromWindows({
        startsAt: START,
        endsAt: END,
        checkInClosesAt: '2026-12-01T23:50:00.000Z',
        checkOutOpensAt: '2026-12-02T00:10:00.000Z',
      }),
    ).toEqual({ arriveBy: 'keep', leaveFrom: 'keep' });
  });
});

describe('describeAttendanceRule', () => {
  it('states the rule in event time', () => {
    expect(describeAttendanceRule(sessionWindows(START, END, '30', '15'))).toBe(
      'Check in by 6:30 PM · check out from 7:45 PM',
    );
  });
});

describe('slugifyEventName', () => {
  it('makes a web address from a name', () => {
    expect(slugifyEventName('Fall Kickoff Night!')).toBe('fall-kickoff-night');
    expect(slugifyEventName('  Café & Código: 2026  ')).toBe('cafe-codigo-2026');
    expect(slugifyEventName('!!!')).toBe('');
    expect(slugifyEventName('a'.repeat(80))).toHaveLength(60);
  });
});

describe('eventStage', () => {
  const now = new Date('2026-12-02T00:00:00.000Z').getTime();
  it('ends a published event by the clock', () => {
    expect(eventStage('published', END, now)).toBe('published');
    expect(eventStage('published', START, now)).toBe('ended');
    expect(eventStage('completed', START, now)).toBe('ended');
    expect(eventStage('draft', START, now)).toBe('draft');
    expect(eventStage('cancelled', END, now)).toBe('cancelled');
  });
});
