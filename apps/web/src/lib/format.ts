export const EVENT_TIME_ZONE = 'America/New_York';

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: EVENT_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: EVENT_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));
}

export function formatTime(value: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: EVENT_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatDateTimeLocalInput(value: string | Date): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: EVENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Converts an America/New_York wall-clock value (from datetime-local) to UTC ISO. */
export function newYorkInputToIso(value: string): string {
  const [datePart, timePart] = value.split('T');
  if (!datePart || !timePart) throw new Error('Invalid date');
  const [year = 0, month = 1, day = 1] = datePart.split('-').map(Number);
  const [hour = 0, minute = 0] = timePart.split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) {
    throw new Error('Invalid date');
  }
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (instant: number): number => {
    const label = new Intl.DateTimeFormat('en-US', {
      timeZone: EVENT_TIME_ZONE,
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date(instant))
      .find((part) => part.type === 'timeZoneName')?.value;
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(label ?? '');
    if (!match) return 0;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3]));
  };

  // Two passes: the offset at the naive UTC instant can differ from the offset
  // at the resolved instant around DST boundaries.
  const firstOffset = offsetAt(guess);
  let resolved = guess - firstOffset * 60_000;
  const secondOffset = offsetAt(resolved);
  if (secondOffset !== firstOffset) {
    resolved = guess - secondOffset * 60_000;
  }
  return new Date(resolved).toISOString();
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
