import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { normalizeProfilePhoto, PhotoError } from './normalize-photo';

function solid(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } },
  });
}

describe('normalizeProfilePhoto', () => {
  it('re-encodes an accepted image to a 512px square WebP without metadata', async () => {
    const input = await solid(800, 600)
      .withExif({ IFD0: { Copyright: 'private camera metadata' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const output = await normalizeProfilePhoto(input);
    const metadata = await sharp(output).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
    expect(metadata.exif).toBeUndefined();
  });

  it('accepts PNG and WebP', async () => {
    await expect(
      normalizeProfilePhoto(await solid(64, 64).png().toBuffer()),
    ).resolves.toBeDefined();
    await expect(
      normalizeProfilePhoto(await solid(64, 64).webp().toBuffer()),
    ).resolves.toBeDefined();
  });

  it('rejects formats sharp can decode but profiles do not allow', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    await expect(normalizeProfilePhoto(svg)).rejects.toThrow('Use a JPEG, PNG or WebP image.');
    const gif = await solid(16, 16).gif().toBuffer();
    await expect(normalizeProfilePhoto(gif)).rejects.toThrow('Use a JPEG, PNG or WebP image.');
  });

  it('rejects decompression bombs and files that are not images', async () => {
    const bomb = await solid(8000, 8000).png({ compressionLevel: 9 }).toBuffer();
    await expect(normalizeProfilePhoto(bomb)).rejects.toBeInstanceOf(PhotoError);
    await expect(normalizeProfilePhoto(Buffer.from('not an image'))).rejects.toBeInstanceOf(
      PhotoError,
    );
  });
});
