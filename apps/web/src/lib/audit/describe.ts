export type AuditEntry = {
  action: string;
  before?: unknown;
  after?: unknown;
};

function field(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'string' || typeof found === 'number' ? String(found) : null;
}

function asType(role: string | null): string {
  return role === 'superadmin'
    ? 'a superadmin'
    : role === 'admin'
      ? 'an admin'
      : role === 'member'
        ? 'a member'
        : 'a different type of user';
}

const METHODS: Record<string, string> = {
  card: ' by card',
  qr: ' by QR code',
  manual: ' by name',
};

/**
 * What an audit entry records, as the end of a sentence that starts with who
 * did it: "wrote a card for Ada". `name` is whoever or whatever the entry is
 * about, when it could still be found; entries outlive the records they name.
 */
export function describeAudit(
  entry: AuditEntry,
  name?: string | null,
  own: 'their' | 'your' = 'their',
): string {
  const who = name || 'someone';
  const whose = name ? `${name}'s` : "someone's";
  const titled = (kind: string) =>
    name ? `the ${kind} ${name}` : `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}`;
  // A deleted record cannot be looked up any more, so its entry carries the name.
  const gone = field(entry.before, 'name');
  const email = field(entry.after, 'email');
  const status = field(entry.after, 'status');
  const method = METHODS[field(entry.after, 'method') ?? ''] ?? '';

  switch (entry.action) {
    case 'invitation.created':
      return `invited ${email ?? 'someone'} as a member`;
    case 'invitation.link_regenerated':
      return 'made a new invitation link';
    case 'invitation.revoked':
      return 'cancelled an invitation';
    case 'admin.invited':
      return `invited ${email ?? 'someone'} as ${asType(field(entry.after, 'role'))}`;
    case 'user.type_changed':
      return `made ${who} ${asType(field(entry.after, 'role'))}`;
    case 'user.access_revoked':
      return `removed ${whose} access`;
    case 'member.status_changed':
      return status === 'suspended'
        ? `suspended ${who}`
        : status === 'archived'
          ? `archived ${who}`
          : status === 'active'
            ? `made ${who} active again`
            : `changed ${whose} status`;
    case 'points.interaction_awarded': {
      const points = field(entry.after, 'points');
      return points ? `gave ${who} ${points} points` : `gave ${who} points`;
    }
    case 'member.recovery_link_generated':
      return `made a password reset link for ${who}`;
    case 'member.setup_completed':
      return `finished setting up ${own} membership`;
    case 'member.profile_updated':
      return `changed ${own} profile`;
    case 'member.privacy_updated':
      return `changed what ${own} profile shows`;
    case 'staff.profile_created':
      return `set up ${own} organizer profile`;
    case 'auth.password_updated':
      return 'set a new password';
    case 'card.usb_prepared':
      return `started a card for ${who}`;
    case 'card.usb_activated':
    case 'card.written_by_device':
      return `wrote a card for ${who}`;
    case 'card.revoked':
      return `switched off ${whose} card`;
    case 'reader.paired':
      return 'set up a card reader';
    case 'reader.provisioned':
      return 'gave a card reader its key from the flashing tool';
    case 'reader.key_rotated':
      return 'gave a card reader a new key';
    case 'reader.cleared':
      return 'took the key off a card reader with the flashing tool';
    case 'event.created':
      return `created ${titled('event')}`;
    case 'event.updated':
      return `changed ${titled('event')}`;
    case 'event.status_changed':
      return status === 'published'
        ? `published ${titled('event')}`
        : status === 'cancelled'
          ? `cancelled ${titled('event')}`
          : status === 'draft'
            ? `moved ${titled('event')} back to a draft`
            : `changed the status of ${titled('event')}`;
    case 'reward.created':
      return `added ${titled('reward')}`;
    case 'reward.updated':
      return `changed ${titled('reward')}`;
    case 'redemption.requested':
      return name ? `asked for ${name}` : 'asked for a reward';
    case 'redemption.cancelled_by_member':
      return name ? `cancelled ${own} request for ${name}` : `cancelled ${own} reward request`;
    case 'redemption.approve':
      return `approved ${name ?? 'a reward request'}`;
    case 'redemption.fulfil':
      return `handed over ${name ?? 'a reward'}`;
    case 'redemption.reject':
      return `rejected ${name ?? 'a reward request'}`;
    case 'redemption.cancel':
      return `cancelled ${name ?? 'a reward request'}`;
    case 'attendance.check_in':
      return `checked ${who} in${method}`;
    case 'attendance.check_out':
      return `checked ${who} out${method}`;
    case 'attendance.correct':
      return `corrected ${whose} attendance`;
    case 'attendance.identity_checked':
      return `checked ${whose} PSU ID`;
    case 'scan.rejected':
      return 'had a scan refused at the kiosk';
    case 'event.deleted':
      return gone ? `deleted the event ${gone} for good` : 'deleted an event for good';
    case 'reward.deleted':
      return gone ? `deleted the reward ${gone} for good` : 'deleted a reward for good';
    case 'redemption.deleted':
      return `deleted ${whose} request for ${gone ?? 'a reward'} for good`;
    case 'card.deleted':
      return `deleted ${whose} card for good`;
    case 'attendance.deleted':
      return gone
        ? `deleted ${whose} attendance at ${gone} for good`
        : `deleted ${whose} attendance record for good`;
    case 'invitation.deleted':
      return 'deleted an invitation for good';
    case 'user.deleted': {
      const kind = field(entry.before, 'kind');
      return kind === 'member'
        ? "deleted a member's account for good"
        : kind === 'organizer'
          ? "deleted an organizer's account for good"
          : 'deleted an account for good';
    }
    default:
      // A code nobody has written a sentence for yet still has to be readable.
      return `recorded "${entry.action.replace(/[._]+/g, ' ')}"`;
  }
}

/** Starts the sentence: "You", a name, or a neutral subject. */
export function auditSentence(subject: string, entry: AuditEntry, name?: string | null): string {
  return `${subject} ${describeAudit(entry, name, subject === 'You' ? 'your' : 'their')}.`;
}

export const AUDIT_TOPICS: { value: string; label: string; prefixes: string[] }[] = [
  {
    value: 'people',
    label: 'People and invitations',
    prefixes: ['invitation.', 'admin.', 'user.', 'member.', 'points.', 'staff.'],
  },
  { value: 'cards', label: 'Cards and readers', prefixes: ['card.', 'reader.'] },
  { value: 'attendance', label: 'Check-in and check-out', prefixes: ['attendance.', 'scan.'] },
  { value: 'events', label: 'Events', prefixes: ['event.'] },
  { value: 'rewards', label: 'Rewards', prefixes: ['reward.', 'redemption.'] },
  { value: 'passwords', label: 'Passwords', prefixes: ['auth.'] },
];
