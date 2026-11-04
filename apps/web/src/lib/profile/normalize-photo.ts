import sharp from 'sharp';

// sharp also decodes SVG, TIFF, GIF and others, and its default pixel limit lets
// a small PNG expand to about a gigabyte of memory.
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MAX_INPUT_PIXELS = 40_000_000;

export class PhotoError extends Error {}

/**
 * Validates, strips metadata, square-crops and re-encodes an uploaded photo.
 * The format is read from the file itself; the client filename and content type
 * are never trusted.
 */
export async function normalizeProfilePhoto(input: Buffer): Promise<Buffer> {
  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS });
    const { format } = await image.metadata();
    if (!format || !ALLOWED_FORMATS.has(format)) {
      throw new PhotoError('Use a JPEG, PNG or WebP image.');
    }
    return await image
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'attention' })
      .webp({ quality: 84 })
      .toBuffer();
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    throw new PhotoError('That file is not a readable image.');
  }
}
