import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  const missing = () => new Response(null, { status: 404, headers });
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(slug)) return missing();

  const admin = createSupabaseAdmin();
  const { data: profile, error } = await admin
    .from('member_profiles')
    .select('photo_path, public_profile, show_photo, members(auth_user_id, status)')
    .eq('profile_slug', slug)
    .maybeSingle();
  if (error || !profile) return missing();
  const member = Array.isArray(profile.members) ? profile.members[0] : profile.members;
  if (!member) return missing();

  let allowed = member.status === 'active' && profile.public_profile && profile.show_photo;
  if (!allowed) {
    const supabase = await createSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id === member.auth_user_id && member.status === 'active') {
      allowed = true;
    } else if (user) {
      const [{ data: role }, { data: assurance }] = await Promise.all([
        admin
          .from('user_roles')
          .select('role')
          .eq('auth_user_id', user.id)
          .eq('role', 'admin')
          .is('revoked_at', null)
          .maybeSingle(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      allowed = role?.role === 'admin' && assurance?.currentLevel === 'aal2';
    }
  }
  if (!allowed) return missing();

  const { data: image, error: downloadError } = await admin.storage
    .from('avatars')
    .download(profile.photo_path);
  if (downloadError || !image) return missing();
  return new Response(await image.arrayBuffer(), {
    headers: { ...headers, 'Content-Type': 'image/webp' },
  });
}
