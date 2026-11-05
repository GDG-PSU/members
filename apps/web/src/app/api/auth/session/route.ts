import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SITE_URL } from '@/lib/env';
import { isSameOriginRequest, safeAuthNextPath } from '@/lib/security/request';
import { createSupabaseServer } from '@/lib/supabase/server';

const bodySchema = z.object({
  accessToken: z.string().min(20),
  refreshToken: z.string().min(10),
  next: z.string().max(200).optional(),
});

const noStore = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  // Without this, a cross-site form post could sign the visitor in to an
  // attacker's account, and whatever they enter next would land there.
  if (!isSameOriginRequest(request, SITE_URL)) {
    return NextResponse.json(
      { error: 'Invalid request origin.' },
      { status: 403, headers: noStore },
    );
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    const raw = await request.json();
    const result = bodySchema.safeParse(raw);
    if (!result.success) throw new Error('invalid');
    parsed = result.data;
  } catch {
    return NextResponse.json(
      { error: 'Invalid session payload.' },
      { status: 400, headers: noStore },
    );
  }

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.setSession({
    access_token: parsed.accessToken,
    refresh_token: parsed.refreshToken,
  });

  if (error) {
    return NextResponse.json(
      { error: 'That sign-in link is invalid or expired.' },
      { status: 401, headers: noStore },
    );
  }

  // Send existing members/admins to their home instead of the setup screen when
  // they used a generic invitation/recovery callback.
  let redirectTo = safeAuthNextPath(parsed.next);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const [{ data: member }, { data: roleRows }] = await Promise.all([
      supabase
        .from('members')
        .select('id')
        .eq('auth_user_id', user.id)
        .eq('kind', 'member')
        .maybeSingle(),
      supabase
        .from('user_roles')
        .select('role')
        .eq('auth_user_id', user.id)
        .in('role', ['admin', 'superadmin'])
        .is('revoked_at', null),
    ]);
    if (member) redirectTo = '/member';
    else if (roleRows?.length) redirectTo = '/admin';
  }

  // The session cookies written through cookies() are attached to this response
  // by Next, with the options the Supabase client set.
  return NextResponse.json({ redirectTo }, { headers: noStore });
}
