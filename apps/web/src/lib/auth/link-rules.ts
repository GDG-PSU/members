/** How long each kind of one-time link works, in hours. The database caps it at 72. */
export const LINK_HOURS = {
  member_invite: 72,
  staff_invite: 72,
  recovery: 48,
} as const;

export type LinkPurpose = keyof typeof LINK_HOURS;

/** Where each kind of link lands once it has signed the person in. */
export const LINK_NEXT: Record<LinkPurpose, string> = {
  member_invite: '/invite/accept',
  staff_invite: '/account/password',
  recovery: '/account/password',
};

/** 32 random bytes in base64url. */
export const LINK_TOKEN = /^[A-Za-z0-9_-]{43}$/;

const HOUR = 3_600_000;

/** An invitation counts as not accepted once its link has stopped working. */
export function inviteExpired(expiresAt: string | null | undefined, now: number): boolean {
  return Boolean(expiresAt) && new Date(expiresAt as string).getTime() <= now;
}

/**
 * For an organizer invited before links were stored: the invitation is taken
 * to have lasted as long as one made today.
 */
export function staffInviteExpiry(invitedAt: string): string {
  return new Date(new Date(invitedAt).getTime() + LINK_HOURS.staff_invite * HOUR).toISOString();
}
