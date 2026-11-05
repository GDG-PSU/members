import { formatTime } from '@/lib/format';

/**
 * An organizer sets two things: how late someone may arrive, and how early they
 * may leave. The four check-in and check-out times stored on a session are
 * worked out from those, so nobody types six date-times per session.
 */
export const CHECK_IN_OPENS_BEFORE_MINUTES = 30;
export const CHECK_OUT_CLOSES_AFTER_MINUTES = 60;

/** Minutes after the start, or `end` for any time before the session ends. */
export const ARRIVE_BY_OPTIONS = [
  { value: '15', label: '15 minutes after it starts' },
  { value: '30', label: '30 minutes after it starts' },
  { value: '45', label: '45 minutes after it starts' },
  { value: '60', label: '1 hour after it starts' },
  { value: 'end', label: 'Any time before it ends' },
] as const;

/** Minutes before the end, or `start` for any time after the session starts. */
export const LEAVE_FROM_OPTIONS = [
  { value: '0', label: 'When it ends' },
  { value: '15', label: '15 minutes before it ends' },
  { value: '30', label: '30 minutes before it ends' },
  { value: 'start', label: 'Any time after it starts' },
] as const;

export type ArriveBy = (typeof ARRIVE_BY_OPTIONS)[number]['value'];
export type LeaveFrom = (typeof LEAVE_FROM_OPTIONS)[number]['value'];

/** `keep` leaves times that match no option exactly as they are stored. */
export const KEEP_TIMES = 'keep';
export const DEFAULT_ARRIVE_BY: ArriveBy = '30';
export const DEFAULT_LEAVE_FROM: LeaveFrom = '15';

export interface SessionWindows {
  checkInOpensAt: string;
  checkInClosesAt: string;
  checkOutOpensAt: string;
  checkOutClosesAt: string;
}

const MINUTE = 60_000;
const iso = (instant: number) => new Date(instant).toISOString();

export function sessionWindows(
  startsAt: string,
  endsAt: string,
  arriveBy: ArriveBy,
  leaveFrom: LeaveFrom,
): SessionWindows {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  // A rule longer than the session itself is capped, so the times stay in order.
  const checkInCloses = arriveBy === 'end' ? end : Math.min(start + Number(arriveBy) * MINUTE, end);
  const checkOutOpens =
    leaveFrom === 'start' ? start : Math.max(end - Number(leaveFrom) * MINUTE, start);
  return {
    checkInOpensAt: iso(start - CHECK_IN_OPENS_BEFORE_MINUTES * MINUTE),
    checkInClosesAt: iso(checkInCloses),
    checkOutOpensAt: iso(checkOutOpens),
    checkOutClosesAt: iso(end + CHECK_OUT_CLOSES_AFTER_MINUTES * MINUTE),
  };
}

/** The options that produce a session's stored times, or `keep` when none does. */
export function rulesFromWindows(session: {
  startsAt: string;
  endsAt: string;
  checkInClosesAt: string;
  checkOutOpensAt: string;
}): { arriveBy: ArriveBy | typeof KEEP_TIMES; leaveFrom: LeaveFrom | typeof KEEP_TIMES } {
  const closes = new Date(session.checkInClosesAt).getTime();
  const opens = new Date(session.checkOutOpensAt).getTime();
  const arriveBy = ARRIVE_BY_OPTIONS.find(
    ({ value }) =>
      new Date(
        sessionWindows(session.startsAt, session.endsAt, value, 'start').checkInClosesAt,
      ).getTime() === closes,
  )?.value;
  const leaveFrom = LEAVE_FROM_OPTIONS.find(
    ({ value }) =>
      new Date(
        sessionWindows(session.startsAt, session.endsAt, 'end', value).checkOutOpensAt,
      ).getTime() === opens,
  )?.value;
  return { arriveBy: arriveBy ?? KEEP_TIMES, leaveFrom: leaveFrom ?? KEEP_TIMES };
}

/** What a member needs to know to earn the points, in one line. */
export function describeAttendanceRule(session: {
  checkInClosesAt: string;
  checkOutOpensAt: string;
}): string {
  return `Check in by ${formatTime(session.checkInClosesAt)} · check out from ${formatTime(session.checkOutOpensAt)}`;
}

/** The public web address for an event, made from its name. */
export function slugifyEventName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

export type EventStage = 'draft' | 'published' | 'ended' | 'cancelled';

/** Nobody has to mark an event finished: a published event ends by the clock. */
export function eventStage(status: string, endsAt: string, now = Date.now()): EventStage {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'draft') return 'draft';
  return new Date(endsAt).getTime() < now ? 'ended' : 'published';
}
