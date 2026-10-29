/**
 * A member who changes their profile photo within this window must show a PSU ID
 * at the kiosk before an organizer confirms attendance. The photo is the identity
 * anchor for check-in, so a fresh photo is treated as unverified until a human
 * compares it with a physical ID.
 */
export const PHOTO_IDENTITY_WINDOW_HOURS = 48;

export function photoChangedWithin(
  photoChangedAt: string | Date | null | undefined,
  now: Date | number = Date.now(),
  hours = PHOTO_IDENTITY_WINDOW_HOURS,
): boolean {
  if (!photoChangedAt) return false;
  const changed = new Date(photoChangedAt).getTime();
  const reference = typeof now === 'number' ? now : now.getTime();
  if (!Number.isFinite(changed) || !Number.isFinite(reference)) return false;
  return Math.abs(reference - changed) <= hours * 60 * 60 * 1000;
}
