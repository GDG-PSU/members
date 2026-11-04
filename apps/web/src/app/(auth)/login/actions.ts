'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { clientAddress, hashForBucket } from '@/lib/security/request';
import { withinRateLimit } from '@/lib/security/rate-limit';
import { createSupabaseServer } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

const TOO_MANY_ATTEMPTS = 'Too many sign-in attempts. Wait a few minutes and try again.';

const loginSchema = z.object({
  email: z.email().max(254).trim().toLowerCase(),
  password: z.string().min(1).max(128),
});

export interface LoginState {
  error?: string;
}

export async function signInAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: 'Enter a valid email and password.' };
  }

  // Supabase Auth sees every sign-in as coming from this server's address, so its
  // own per-IP limit cannot tell one attacker from a room full of members.
  const [addressAllowed, accountAllowed] = await Promise.all([
    withinRateLimit(`login:ip:${hashForBucket(clientAddress(await headers()))}`, 60, 300),
    withinRateLimit(`login:email:${hashForBucket(parsed.data.email)}`, 10, 300),
  ]);
  if (!addressAllowed || !accountAllowed) {
    return { error: TOO_MANY_ATTEMPTS };
  }

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error?.status === 429) {
    return { error: TOO_MANY_ATTEMPTS };
  }
  if (error || !data.user) {
    return { error: 'Email or password is incorrect.' };
  }

  const admin = createSupabaseAdmin();
  const [{ data: member }, { data: roleRows }] = await Promise.all([
    admin.from('members').select('id, status').eq('auth_user_id', data.user.id).maybeSingle(),
    admin
      .from('user_roles')
      .select('role')
      .eq('auth_user_id', data.user.id)
      .in('role', ['admin', 'superadmin'])
      .is('revoked_at', null),
  ]);

  if (member && member.status !== 'active') {
    await supabase.auth.signOut({ scope: 'local' });
    return { error: 'This membership is not active. Contact GDG@PSU.' };
  }
  if (member) redirect('/member');
  if (roleRows?.length) redirect('/admin');
  redirect('/invite/accept');
}
