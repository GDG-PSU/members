'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServer } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

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

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    return { error: 'Email or password is incorrect.' };
  }

  const admin = createSupabaseAdmin();
  const [{ data: member }, { data: role }] = await Promise.all([
    admin.from('members').select('id, status').eq('auth_user_id', data.user.id).maybeSingle(),
    admin.from('user_roles').select('role').eq('auth_user_id', data.user.id).is('revoked_at', null).maybeSingle(),
  ]);

  if (member && member.status !== 'active') {
    await supabase.auth.signOut();
    return { error: 'This membership is not active. Contact GDG@PSU.' };
  }
  if (member) redirect('/member');
  if (role?.role === 'admin') redirect('/admin');
  redirect('/invite/accept');
}
