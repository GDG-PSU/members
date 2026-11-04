import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const supabase = await createSupabaseServer();
  // The default scope ends every device's session, which would sign an organizer
  // out of the kiosk laptop when they sign out on a phone.
  await supabase.auth.signOut({ scope: 'local' });
  const url = new URL('/login?notice=signed-out', request.url);
  return NextResponse.redirect(url, { status: 303 });
}
