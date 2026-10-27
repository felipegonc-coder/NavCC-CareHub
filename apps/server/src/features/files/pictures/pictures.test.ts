import { describe, expect, it } from 'vitest';
import { cleanPicture, PictureError, type Piece } from './index';
import { DETAIL, sampleGif, sampleHeic, sampleJpeg, samplePng, sampleWebp } from './testing';

const clean = (mimeType: string, file: Buffer) =>
  cleanPicture(mimeType, {
    size: file.length,
    read: async (offset, length) => file.subarray(offset, offset + length),
  });

const rebuild = (file: Buffer, pieces: readonly Piece[] | null) =>
  pieces
    ? Buffer.concat(
        pieces.map((piece) =>
          Buffer.isBuffer(piece) ? piece : file.subarray(piece.start, piece.end),
        ),
      )
    : file;

const SAMPLES = [
  { mimeType: 'image/jpeg', ...sampleJpeg() },
  { mimeType: 'image/png', ...samplePng() },
  { mimeType: 'image/webp', ...sampleWebp() },
  { mimeType: 'image/gif', ...sampleGif() },
  { mimeType: 'image/heic', ...sampleHeic() },
];

describe('cleanPicture', () => {
  for (const sample of SAMPLES) {
    it(`removes the details from a ${sample.mimeType} picture, keeping it upright (DS-07)`, async () => {
      expect(sample.file.includes(DETAIL)).toBe(true);
      const result = await clean(sample.mimeType, sample.file);
      const cleaned = rebuild(sample.file, result?.pieces ?? null);
      expect(cleaned.includes(DETAIL)).toBe(false);
      expect(cleaned.equals(sample.cleaned)).toBe(true);
      expect(result).toMatchObject({ width: sample.width, height: sample.height });

      const again = await clean(sample.mimeType, cleaned);
      expect(again).toEqual({ width: sample.width, height: sample.height, pieces: null });
    });
  }

  it('leaves SVG drawings as they are', async () => {
    expect(
      await clean('image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull();
  });

  it('refuses damaged pictures, and never fails otherwise on cut-off ones', async () => {
    const { file } = samplePng();
    const longer = Buffer.from(file);
    longer.writeUInt32BE(0x7fff0000, 8); // the first chunk says it's longer than the file
    await expect(clean('image/png', longer)).rejects.toBeInstanceOf(PictureError);

    for (const sample of SAMPLES) {
      for (let length = 0; length < sample.file.length; length += 1) {
        const cut = sample.file.subarray(0, length);
        const outcome = await clean(sample.mimeType, cut).then(
          () => 'cleaned',
          (error: unknown) => (error instanceof PictureError ? 'refused' : error),
        );
        expect(['cleaned', 'refused']).toContain(outcome);
      }
    }
  });
});
