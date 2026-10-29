import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { ZodError, type ZodType } from 'zod';
import type { ApiErrorBody, ApiErrorCode } from '@gdg/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly requestId = '',
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function requestId(request?: Request): string {
  const header = request?.headers.get('x-request-id');
  if (header && header.length >= 8 && header.length <= 64) return header;
  return randomUUID();
}

const noStore = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
};

export function jsonError(
  status: number,
  code: ApiErrorCode,
  message: string,
  id: string,
  details?: Record<string, unknown>,
) {
  const body: ApiErrorBody = {
    error: { code, message, requestId: id, ...(details ? { details } : {}) },
  };
  return NextResponse.json(body, { status, headers: noStore });
}

export function jsonOk<T>(data: T, init?: { status?: number; headers?: Record<string, string> }) {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: { ...noStore, ...(init?.headers ?? {}) },
  });
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new ApiError(415, 'bad_request', 'Expected application/json');
  }
  const text = await request.text();
  if (text.length > 16_384) {
    throw new ApiError(413, 'bad_request', 'Payload too large');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'bad_request', 'Malformed JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, 'bad_request', 'Invalid request', '', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

export function handleApiError(error: unknown, id: string) {
  if (error instanceof ApiError) {
    return jsonError(error.status, error.code, error.message, error.requestId || id, error.details);
  }
  if (error instanceof ZodError) {
    return jsonError(400, 'bad_request', 'Invalid request', id);
  }
  const message = error instanceof Error ? error.message : 'Unexpected error';
  const known: Record<string, [number, ApiErrorCode, string]> = {
    insufficient_points: [409, 'conflict', 'Not enough points for this redemption.'],
    out_of_stock: [409, 'conflict', 'That reward is out of stock.'],
    reward_unavailable: [409, 'conflict', 'That reward is no longer available.'],
    duplicate_check_in: [409, 'conflict', 'This member is already checked in.'],
    duplicate_check_out: [409, 'conflict', 'This member is already checked out.'],
    no_check_in_found: [409, 'conflict', 'No check-in exists for this session.'],
    outside_check_in_window: [409, 'conflict', 'Check-in is closed for this session.'],
    outside_check_out_window: [409, 'conflict', 'Check-out is closed for this session.'],
    scan_expired: [410, 'expired', 'This scan has expired. Ask the member to tap again.'],
    scan_already_handled: [409, 'conflict', 'This scan was already handled.'],
    invitation_not_found: [403, 'forbidden', 'No pending invitation matches this account.'],
    invitation_expired: [410, 'expired', 'This invitation has expired. Contact GDG@PSU.'],
    member_not_active: [403, 'forbidden', 'This membership is not active.'],
    job_expired: [410, 'expired', 'The write job expired. Queue a new one.'],
    card_not_writable: [409, 'conflict', 'That card is not ready to be written.'],
    device_not_in_writer_mode: [409, 'conflict', 'The device is not in writer mode.'],
  };
  const mapped = known[message];
  if (mapped) {
    return jsonError(mapped[0], mapped[1], mapped[2], id);
  }
  console.error(`[api:${id}]`, message);
  return jsonError(500, 'internal_error', 'Something went wrong.', id);
}
