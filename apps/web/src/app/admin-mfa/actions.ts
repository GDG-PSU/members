'use server';

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';

export interface MfaState {
  error?: string;
  factorId?: string;
  qrCode?: string;
  secret?: string;
}

async function requireAdminViewer() {
  const viewer = await getViewer();
  if (!viewer.user || !viewer.isAdmin) {
    throw new Error('forbidden');
  }
  return viewer;
}

export async function enrollMfaAction(_prev: MfaState, _formData: FormData): Promise<MfaState> {
  const viewer = await requireAdminViewer();
  const { data: factors } = await viewer.supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.status === 'unverified') {
      await viewer.supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await viewer.supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'GDG@PSU organizer',
  });
  if (error || !data) {
    return { error: error?.message ?? 'Could not start authenticator enrollment.' };
  }

  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyMfaAction(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const viewer = await requireAdminViewer();
  const factorId = String(formData.get('factorId') ?? '');
  const code = String(formData.get('code') ?? '').replace(/\s+/g, '');
  if (!factorId || !/^\d{6}$/.test(code)) {
    return { error: 'Enter the six-digit code from your authenticator.', factorId };
  }

  const challenge = await viewer.supabase.auth.mfa.challenge({ factorId });
  if (challenge.error || !challenge.data) {
    return { error: 'Could not start the verification challenge. Try again.', factorId };
  }

  const { error } = await viewer.supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code,
  });
  if (error) {
    return { error: 'That code did not work. Wait for a new code and try again.', factorId };
  }

  redirect('/admin');
}
