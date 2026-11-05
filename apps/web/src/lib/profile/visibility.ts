import { defaultVisibility, type Visibility } from '@gdg/contracts';

/** The `member_profiles` column behind each privacy switch. */
export const VISIBILITY_COLUMNS: Record<keyof Visibility, string> = {
  publicProfile: 'public_profile',
  showDisplayName: 'show_display_name',
  showPhoto: 'show_photo',
  showAbout: 'show_about',
  showLinks: 'show_links',
  showMemberNumber: 'show_member_number',
  showMemberSince: 'show_member_since',
  showPoints: 'show_points',
  showStars: 'show_stars',
  showEvents: 'show_events',
  showOnLeaderboard: 'show_on_leaderboard',
  showEmail: 'show_email',
};

export const VISIBILITY_SELECT = Object.values(VISIBILITY_COLUMNS).join(', ');

/** Reads the switches from a profile row, keeping the default for anything missing. */
export function readVisibility(row: unknown): Visibility {
  const values = (row ?? {}) as Record<string, unknown>;
  const visibility = { ...defaultVisibility };
  for (const key of Object.keys(VISIBILITY_COLUMNS) as (keyof Visibility)[]) {
    const value = values[VISIBILITY_COLUMNS[key]];
    if (typeof value === 'boolean') visibility[key] = value;
  }
  return visibility;
}
