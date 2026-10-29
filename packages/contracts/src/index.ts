import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                          */
/* -------------------------------------------------------------------------- */

export const uuidSchema = z.uuid();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const apiErrorCodeSchema = z.enum([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'device_unauthorized',
  'expired',
  'offline',
  'internal_error',
]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

export const requestIdSchema = z.string().min(8).max(64);

/* -------------------------------------------------------------------------- */
/* Profiles and visibility                                                    */
/* -------------------------------------------------------------------------- */

export const linkSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: z
    .string()
    .trim()
    .max(300)
    .refine((value) => /^https:\/\/[^\s]+$/i.test(value), 'Only https:// links are allowed'),
});

export const aboutSchema = z.string().trim().max(280);

export const visibilitySchema = z.object({
  publicProfile: z.boolean(),
  showDisplayName: z.boolean(),
  showPhoto: z.boolean(),
  showAbout: z.boolean(),
  showLinks: z.boolean(),
  showMemberNumber: z.boolean(),
  showMemberSince: z.boolean(),
  showPoints: z.boolean(),
  showStars: z.boolean(),
  showEvents: z.boolean(),
  showOnLeaderboard: z.boolean(),
  showEmail: z.boolean(),
});

export type Visibility = z.infer<typeof visibilitySchema>;

export const defaultVisibility: Visibility = {
  publicProfile: true,
  showDisplayName: true,
  showPhoto: true,
  showAbout: true,
  showLinks: true,
  showMemberNumber: true,
  showMemberSince: true,
  showPoints: true,
  showStars: true,
  showEvents: true,
  showOnLeaderboard: true,
  showEmail: true,
};

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  about: aboutSchema.optional().or(z.literal('')),
  links: z.array(linkSchema).max(6).default([]),
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const setupCompletionSchema = z.object({
  displayName: z.string().trim().min(2, 'Use at least 2 characters').max(60),
  password: z
    .string()
    .min(12, 'Use at least 12 characters')
    .max(128)
    .refine((value) => /[a-zA-Z]/.test(value) && /\d/.test(value), {
      message: 'Include at least one letter and one number',
    }),
  about: aboutSchema.optional().or(z.literal('')),
  photoPath: z.string().trim().min(3).max(300),
  acceptTerms: z.literal(true),
});

export type SetupCompletion = z.infer<typeof setupCompletionSchema>;

/* -------------------------------------------------------------------------- */
/* Public projections                                                         */
/* -------------------------------------------------------------------------- */

export interface PublicProfile {
  slug: string;
  displayName: string | null;
  photoUrl: string | null;
  about: string | null;
  links: { label: string; url: string }[];
  memberNumber: string | null;
  memberSince: string | null;
  points: number | null;
  stars: number | null;
  attendedEvents: number | null;
  email: string | null;
  createdAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  slug: string;
  displayName: string;
  photoUrl: string | null;
  memberNumber: string | null;
  points: number;
}

export const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});

/* -------------------------------------------------------------------------- */
/* Invitations and admin                                                      */
/* -------------------------------------------------------------------------- */

export const invitationCreateSchema = z.object({
  email: z.email().trim().toLowerCase().max(254),
  paidSince: z.iso.date(),
  note: z.string().trim().max(300).optional().or(z.literal('')),
});

export const invitationActionSchema = z.object({
  invitationId: uuidSchema,
  action: z.enum(['resend', 'revoke']),
});

export const memberStatusSchema = z.object({
  memberId: uuidSchema,
  status: z.enum(['active', 'suspended', 'archived']),
  reason: z.string().trim().min(3).max(300),
});

/* -------------------------------------------------------------------------- */
/* Events and attendance                                                      */
/* -------------------------------------------------------------------------- */

export const eventSessionInputSchema = z
  .object({
    id: uuidSchema.optional(),
    name: z.string().trim().min(2).max(80),
    kind: z.enum(['main', 'bonus']),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    checkInOpensAt: isoDateTimeSchema,
    checkInClosesAt: isoDateTimeSchema,
    checkOutOpensAt: isoDateTimeSchema,
    checkOutClosesAt: isoDateTimeSchema,
    minimumDurationMinutes: z.number().int().min(0).max(1440),
    rewardPoints: z.number().int().min(0).max(10_000),
    isEnabled: z.boolean().default(true),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: 'Session must end after it starts',
    path: ['endsAt'],
  })
  .refine((value) => new Date(value.checkOutClosesAt) > new Date(value.checkInOpensAt), {
    message: 'Check-out window must close after check-in opens',
    path: ['checkOutClosesAt'],
  });

export const eventInputSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words separated by dashes'),
    summary: z.string().trim().max(400),
    location: z.string().trim().max(160),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    status: z.enum(['draft', 'published', 'cancelled', 'completed']),
    isPublic: z.boolean().default(true),
    sessions: z.array(eventSessionInputSchema).min(1).max(6),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: 'Event must end after it starts',
    path: ['endsAt'],
  })
  .refine((value) => value.sessions.filter((s) => s.kind === 'main').length === 1, {
    message: 'An event needs exactly one main session',
    path: ['sessions'],
  });

export const scanConfirmSchema = z.object({
  scanId: uuidSchema,
  action: z.enum(['check_in', 'check_out', 'reject']),
  reason: z.string().trim().max(300).optional(),
  // Required by the API when the member changed their photo in the last 48h.
  identityCheck: z.boolean().optional(),
});

export const interactionRewardSchema = z.object({
  memberId: uuidSchema,
  points: z.number().int().min(1).max(10_000),
  reason: z.string().trim().min(3).max(300),
  eventId: uuidSchema.optional(),
  sessionId: uuidSchema.optional(),
});

export const attendanceCorrectionSchema = z.object({
  attendanceId: uuidSchema,
  action: z.enum(['qualify', 'disqualify', 'set_checkout', 'clear_checkout']),
  checkedOutAt: isoDateTimeSchema.optional(),
  reason: z.string().trim().min(5).max(300),
});

/* -------------------------------------------------------------------------- */
/* Rewards                                                                    */
/* -------------------------------------------------------------------------- */

export const rewardInputSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300),
  costPoints: z.number().int().min(1).max(10_000),
  inventory: z.number().int().min(0).max(10_000).nullable(),
  isActive: z.boolean().default(true),
  fulfillmentNote: z.string().trim().max(300).default(''),
});

export const redemptionRequestSchema = z.object({
  rewardId: uuidSchema,
  quantity: z.number().int().min(1).max(5).default(1),
  idempotencyKey: z.string().min(8).max(64),
});

export const redemptionDecisionSchema = z.object({
  redemptionId: uuidSchema,
  action: z.enum(['approve', 'reject', 'fulfil', 'cancel']),
  reason: z.string().trim().max(300).optional(),
});

/* -------------------------------------------------------------------------- */
/* Cards and devices                                                          */
/* -------------------------------------------------------------------------- */

export const cardPrepareSchema = z.object({
  memberId: uuidSchema,
  deviceId: uuidSchema,
  reason: z.string().trim().max(200).optional(),
});

export const cardRevokeSchema = z.object({
  cardId: uuidSchema,
  reason: z.string().trim().min(3).max(300),
});

export const deviceCreateSchema = z.object({
  deviceId: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{2,31}$/, 'Lowercase letters, numbers and dashes'),
  laneLabel: z.string().trim().min(1).max(40),
  mode: z.enum(['kiosk', 'writer']).default('kiosk'),
  eventId: uuidSchema.optional().nullable(),
  sessionId: uuidSchema.optional().nullable(),
});

export const deviceUpdateSchema = z.object({
  deviceId: uuidSchema,
  laneLabel: z.string().trim().min(1).max(40).optional(),
  mode: z.enum(['kiosk', 'writer']).optional(),
  eventId: uuidSchema.optional().nullable(),
  sessionId: uuidSchema.optional().nullable(),
  enabled: z.boolean().optional(),
  rotateSecret: z.boolean().optional(),
});

/* -------------------------------------------------------------------------- */
/* Device middleware API (v1)                                                 */
/* -------------------------------------------------------------------------- */

export const deviceHeadersSchema = z.object({
  'x-device-id': z.string().min(3).max(40),
  'x-device-timestamp': z.string().regex(/^\d{10}$/),
  'x-device-signature': z.string().regex(/^[a-f0-9]{64}$/),
  'x-request-id': z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
});

export const deviceHeartbeatSchema = z.object({
  firmwareVersion: z.string().trim().min(1).max(40),
  mode: z.enum(['kiosk', 'writer']),
  ipHint: z.string().trim().max(64).optional(),
  diagnostics: z
    .object({
      rssi: z.number().int().min(-120).max(0).optional(),
      uptimeSeconds: z.number().int().min(0).optional(),
      nfcReady: z.boolean().optional(),
    })
    .optional(),
});

export const deviceScanSchema = z.object({
  cardToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Expected an opaque card token'),
  idempotencyKey: z.string().min(8).max(64),
  firmwareVersion: z.string().trim().min(1).max(40),
  scannedAt: isoDateTimeSchema.optional(),
});

export const deviceWriteClaimSchema = z.object({
  firmwareVersion: z.string().trim().min(1).max(40),
});

export const deviceWriteCompleteSchema = z.object({
  jobId: uuidSchema,
  status: z.enum(['written', 'failed']),
  readBackMatches: z.boolean().optional(),
  failureCode: z.string().trim().max(60).optional(),
  ndefLength: z.number().int().min(0).max(1024).optional(),
});

export type DeviceScanInput = z.infer<typeof deviceScanSchema>;
export type DeviceHeartbeatInput = z.infer<typeof deviceHeartbeatSchema>;

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

export const themePreferenceSchema = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Public fields that may ever appear in an anonymous response. */
export const PUBLIC_PROFILE_FIELDS = [
  'slug',
  'displayName',
  'photoUrl',
  'about',
  'links',
  'memberNumber',
  'memberSince',
  'points',
  'stars',
  'attendedEvents',
  'email',
  'createdAt',
] as const;
