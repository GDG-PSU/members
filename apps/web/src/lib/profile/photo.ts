import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class PhotoError extends Error {}

/**
 * Validates, strips metadata, square-crops and re-encodes an uploaded photo.
 * The client filename and content type are never trusted.
 */
export async function storeProfilePhoto(file: File, ownerId: string): Promise<string> {
  if (!ALLOWED.has(file.type)) {
    throw new PhotoError('Use a JPEG, PNG or WebP image.');
  }
  if (file.size > MAX_BYTES) {
    throw new PhotoError('Images must be 2 MB or smaller.');
  }
  const input = Buffer.from(await file.arrayBuffer());
  if (input.length === 0) throw new PhotoError('The image was empty.');

  let output: Buffer;
  try {
    output = await sharp(input)
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'attention' })
      .webp({ quality: 84 })
      .toBuffer();
  } catch {
    throw new PhotoError('That file is not a readable image.');
  }

  const path = `member/${ownerId}/${randomUUID()}.webp`;
  const supabase = createSupabaseAdmin();
  const { error } = await supabase.storage.from('avatars').upload(path, output, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) {
    console.error('[photo] upload failed', error.message);
    throw new PhotoError('The photo could not be stored. Try again.');
  }
  return path;
}

export function publicPhotoUrl(path: string | null): string | null {
  if (!path) return null;
  const supabase = createSupabaseAdmin();
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}
