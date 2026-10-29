import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServer } from '@/lib/supabase/server';

const bodySchema = z.object({
  accessToken: z.string().min(20),
  refreshToken: z.string().min(10),
  next: z.string().startsWith('/').max(200).default('/invite/accept'),
});

export async function POST(request: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    const raw = await request.json();
    const result = bodySchema.safeParse(raw);
    if (!result.success) throw new Error('invalid');
    parsed = result.data;
  } catch {
    return NextResponse.json({ error: 'Invalid session payload.' }, { status: 400 });
  }

  const safeNext = parsed.next.startsWith('//') ? '/invite/accept' : parsed.next;
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.setSession({
    access_token: parsed.accessToken,
    refresh_token: parsed.refreshToken,
  });

  if (error) {
    return NextResponse.json(
      { error: 'That sign-in link is invalid or expired.' },
      { status: 401 },
    );
  }

  // Send existing members/admins to their home instead of the setup screen when
  // they used a generic invitation/recovery callback.
  let redirectTo = safeNext;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const [{ data: member }, { data: role }] = await Promise.all([
      supabase.from('members').select('id').eq('auth_user_id', user.id).maybeSingle(),
      supabase
        .from('user_roles')
        .select('role')
        .eq('auth_user_id', user.id)
        .is('revoked_at', null)
        .maybeSingle(),
    ]);
    if (member) redirectTo = '/member';
    else if (role?.role === 'admin') redirectTo = '/admin';
  }

  const cookieStore = await cookies();
  const response = NextResponse.json({ redirectTo });
  for (const cookie of cookieStore.getAll()) {
    response.cookies.set(cookie);
  }
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
