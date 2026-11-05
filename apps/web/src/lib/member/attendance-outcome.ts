export type AttendanceFacts = {
  state: string;
  qualified: boolean;
  rewardPoints: number;
  checkedOutAt: string | null;
  durationMinutes: number | null;
  /** What the session asks for; null when the session could not be read. */
  sessionReward: number | null;
  minimumMinutes: number | null;
  checkOutClosesAt: string | null;
};

export type AttendanceOutcome = {
  earned: boolean;
  label: string;
  /** Why no points were given, or what is still needed. */
  detail: string | null;
};

/** Says what a member got for a session and, when it was nothing, why. */
export function attendanceOutcome(row: AttendanceFacts, now: number): AttendanceOutcome {
  if (row.qualified && row.rewardPoints > 0) {
    return { earned: true, label: `+${row.rewardPoints} points`, detail: null };
  }
  if (row.qualified || (row.state === 'completed' && row.sessionReward === 0)) {
    return { earned: false, label: 'Attended', detail: 'This session does not give points.' };
  }
  if (row.state === 'rejected') {
    return { earned: false, label: 'No points', detail: 'This check-in was not accepted.' };
  }
  if (!row.checkedOutAt) {
    const stillOpen = row.checkOutClosesAt
      ? now <= new Date(row.checkOutClosesAt).getTime()
      : false;
    return stillOpen
      ? {
          earned: false,
          label: 'Checked in',
          detail: 'Check out before you leave to get your points.',
        }
      : {
          earned: false,
          label: 'No points',
          detail: 'You did not check out, so no points were given.',
        };
  }
  if (
    row.durationMinutes !== null &&
    row.minimumMinutes !== null &&
    row.durationMinutes < row.minimumMinutes
  ) {
    return {
      earned: false,
      label: 'No points',
      detail: `You stayed ${row.durationMinutes} min and this session needs ${row.minimumMinutes}.`,
    };
  }
  return {
    earned: false,
    label: 'No points',
    detail: 'An organizer changed this record.',
  };
}
