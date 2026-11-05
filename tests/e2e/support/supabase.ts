import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

/** Service-role client used only by the test runner to set up and clean up fixtures. */
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required for E2E tests.');
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-application-name': 'gdgpsu-e2e' } },
  });
}

export interface DisposableAdmin {
  user: User;
}

/**
 * Creates a confirmed Auth user and grants the admin role. No email is sent;
 * the account is deleted by the spec's cleanup step.
 *
 * Every admin page needs the organizer's own profile, so one is created too
 * unless `profile: false` asks for an account that has not set theirs up yet.
 */
export async function createDisposableAdmin(
  client: SupabaseClient,
  input: { email: string; password: string; role?: 'admin' | 'superadmin'; profile?: boolean },
): Promise<DisposableAdmin> {
  const { data, error } = await client.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { purpose: 'e2e-admin' },
  });
  if (error || !data.user) {
    throw new Error(`Could not create the disposable admin: ${error?.message ?? 'unknown error'}`);
  }

  const { error: roleError } = await client.from('user_roles').insert({
    auth_user_id: data.user.id,
    role: input.role ?? 'admin',
    note: 'Disposable account created by the authenticated E2E suite.',
  });
  if (roleError) {
    await client.auth.admin.deleteUser(data.user.id).catch(() => {});
    throw new Error(`Could not grant the disposable admin role: ${roleError.message}`);
  }

  if (input.profile !== false) {
    const { error: profileError } = await client.rpc('complete_staff_profile', {
      p_auth_user_id: data.user.id,
      p_profile_slug: randomBytes(18).toString('base64url'),
      p_public_number: `GDG-${randomBytes(3).toString('hex').toUpperCase()}`,
      p_display_name: 'E2E Organizer',
      p_photo_path: null,
      p_about: '',
      p_show_email: false,
    });
    if (profileError) {
      await client.auth.admin.deleteUser(data.user.id).catch(() => {});
      throw new Error(`Could not create the disposable admin profile: ${profileError.message}`);
    }
  }

  return { user: data.user };
}

/** Removes the avatar objects and Auth user for a fixture member. */
export async function deleteMemberFixture(
  client: SupabaseClient,
  authUserId: string,
): Promise<void> {
  const { data: files } = await client.storage.from('avatars').list(`member/${authUserId}`);
  if (files && files.length > 0) {
    await client.storage
      .from('avatars')
      .remove(files.map((file) => `member/${authUserId}/${file.name}`));
  }
  // Fixture members can now have attendance and ledger history. Use the
  // reviewed erasure path so the append-only guards cascade correctly.
  const { error } = await client.rpc('erase_member', { p_auth_user_id: authUserId });
  if (error) throw new Error(`Could not delete member fixture ${authUserId}: ${error.message}`);
}

/** Removes the disposable Auth user. */
export async function deleteAdminFixture(
  client: SupabaseClient,
  authUserId: string,
): Promise<void> {
  const { error } = await client.rpc('erase_member', { p_auth_user_id: authUserId });
  if (error) throw new Error(`Could not delete admin fixture ${authUserId}: ${error.message}`);
}
