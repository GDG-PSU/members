import { randomUUID } from 'node:crypto';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { MAX_PROFILE_PHOTO_BYTES, PROFILE_PHOTO_TOO_LARGE } from '@/lib/profile/limits';
import { normalizeProfilePhoto, PhotoError } from '@/lib/profile/normalize-photo';
import { withinRateLimit } from '@/lib/security/rate-limit';

export { PhotoError };

export async function storeProfilePhoto(file: File, ownerId: string): Promise<string> {
  if (file.size > MAX_PROFILE_PHOTO_BYTES) {
    throw new PhotoError(PROFILE_PHOTO_TOO_LARGE);
  }
  const input = Buffer.from(await file.arrayBuffer());
  if (input.length === 0) throw new PhotoError('The image was empty.');

  // Decoding is the most expensive thing a signed-in account can trigger.
  if (!(await withinRateLimit(`photo-upload:${ownerId}`, 10, 3600))) {
    throw new PhotoError('Too many photo uploads. Try again later.');
  }

  const output = await normalizeProfilePhoto(input);

  const path = `member/${ownerId}/${randomUUID()}.webp`;
  const supabase = createSupabaseAdmin();
  const { error } = await supabase.storage.from('avatars').upload(path, output, {
    contentType: 'image/webp',
    cacheControl: '0',
    upsert: false,
  });
  if (error) {
    console.error('[photo] upload failed', error.message);
    throw new PhotoError('The photo could not be stored. Try again.');
  }
  return path;
}

// The slug is an opaque public identifier, never the storage path or auth ID.
// The endpoint checks current visibility (or owner/admin authorization) on every request.
export function profilePhotoUrl(slug: string | null): string | null {
  return slug ? `/api/profile-photo/${encodeURIComponent(slug)}` : null;
}
