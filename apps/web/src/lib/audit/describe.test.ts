import { describe, expect, it } from 'vitest';
import { AUDIT_TOPICS, auditSentence, describeAudit } from './describe';

describe('describeAudit', () => {
  it('names the person an action was about', () => {
    expect(describeAudit({ action: 'card.usb_activated' }, 'Ada')).toBe('wrote a card for Ada');
    expect(describeAudit({ action: 'card.revoked' }, 'Ada')).toBe("switched off Ada's card");
    expect(
      describeAudit({ action: 'points.interaction_awarded', after: { points: 25 } }, 'Ada'),
    ).toBe('gave Ada 25 points');
  });

  it('still reads as a sentence when the record is gone', () => {
    expect(describeAudit({ action: 'card.usb_activated' })).toBe('wrote a card for someone');
    expect(describeAudit({ action: 'user.access_revoked' }, null)).toBe("removed someone's access");
    expect(describeAudit({ action: 'event.updated' })).toBe('changed an event');
    expect(describeAudit({ action: 'redemption.approve' })).toBe('approved a reward request');
  });

  it('reads the outcome from what was recorded', () => {
    expect(
      describeAudit({ action: 'user.type_changed', after: { role: 'superadmin' } }, 'Ada'),
    ).toBe('made Ada a superadmin');
    expect(describeAudit({ action: 'user.type_changed', after: { role: 'admin' } }, 'Ada')).toBe(
      'made Ada an admin',
    );
    expect(
      describeAudit({ action: 'member.status_changed', after: { status: 'suspended' } }, 'Ada'),
    ).toBe('suspended Ada');
    expect(
      describeAudit({ action: 'event.status_changed', after: { status: 'published' } }, 'Kickoff'),
    ).toBe('published the event Kickoff');
    expect(describeAudit({ action: 'attendance.check_in', after: { method: 'qr' } }, 'Ada')).toBe(
      'checked Ada in by QR code',
    );
    expect(describeAudit({ action: 'attendance.check_out' }, 'Ada')).toBe('checked Ada out');
  });

  it('describes an invitation by the address it went to', () => {
    expect(
      describeAudit({ action: 'admin.invited', after: { email: 'a@psu.edu', role: 'admin' } }),
    ).toBe('invited a@psu.edu as an admin');
    expect(describeAudit({ action: 'invitation.created', after: { email: 'b@psu.edu' } })).toBe(
      'invited b@psu.edu as a member',
    );
  });

  it('names a deleted record from the entry itself, and never a deleted person', () => {
    expect(describeAudit({ action: 'event.deleted', before: { name: 'Kickoff' } })).toBe(
      'deleted the event Kickoff for good',
    );
    expect(describeAudit({ action: 'reward.deleted', before: { name: 'Mug' } })).toBe(
      'deleted the reward Mug for good',
    );
    expect(describeAudit({ action: 'card.deleted' }, 'Ada')).toBe("deleted Ada's card for good");
    expect(
      describeAudit({ action: 'attendance.deleted', before: { name: 'Kickoff' } }, 'Ada'),
    ).toBe("deleted Ada's attendance at Kickoff for good");
    expect(describeAudit({ action: 'user.deleted', before: { kind: 'member' } }, 'Ada')).toBe(
      "deleted a member's account for good",
    );
    expect(describeAudit({ action: 'user.deleted', before: { kind: 'organizer' } })).toBe(
      "deleted an organizer's account for good",
    );
  });

  it('keeps an unknown code readable instead of hiding it', () => {
    expect(describeAudit({ action: 'thing.was_done' })).toBe('recorded "thing was done"');
  });

  it('builds the whole sentence', () => {
    expect(auditSentence('You', { action: 'auth.password_updated' })).toBe(
      'You set a new password.',
    );
    expect(auditSentence('You', { action: 'member.profile_updated' })).toBe(
      'You changed your profile.',
    );
    expect(auditSentence('Ada', { action: 'member.profile_updated' })).toBe(
      'Ada changed their profile.',
    );
  });
});

describe('AUDIT_TOPICS', () => {
  it('gives every known kind of action a topic', () => {
    const prefixes = AUDIT_TOPICS.flatMap((topic) => topic.prefixes);
    for (const action of [
      'invitation.created',
      'admin.invited',
      'user.type_changed',
      'member.status_changed',
      'points.interaction_awarded',
      'staff.profile_created',
      'card.revoked',
      'attendance.check_in',
      'scan.rejected',
      'event.created',
      'reward.created',
      'redemption.approve',
      'auth.password_updated',
    ]) {
      expect(
        prefixes.some((prefix) => action.startsWith(prefix)),
        action,
      ).toBe(true);
    }
  });
});
