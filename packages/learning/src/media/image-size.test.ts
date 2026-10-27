import { describe, expect, it } from 'vitest';
import { readImageSize } from './image-size';

type Part = string | number | readonly number[];
/** Bytes from parts: strings are Latin-1 characters, numbers single bytes. */
const bytes = (...parts: Part[]): Uint8Array =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === 'string'
        ? Array.from(part, (c) => c.charCodeAt(0))
        : typeof part === 'number'
          ? [part]
          : [...part],
    ),
  );
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const be32 = (n: number) => [...be16(Math.floor(n / 0x10000)), ...be16(n & 0xffff)];
const le32 = (n: number) => [...le16(n & 0xffff), ...le16(Math.floor(n / 0x10000))];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];

const png = (width: number, height: number) =>
  bytes('\x89PNG\r\n\x1a\n', be32(13), 'IHDR', be32(width), be32(height), [8, 6, 0, 0, 0], be32(0));

const jfif = bytes([0xff, 0xe0], be16(16), 'JFIF\0', [1, 1, 0], be16(72), be16(72), [0, 0]);
const sof = (marker: number, width: number, height: number) =>
  bytes(
    [0xff, marker],
    be16(17),
    8,
    be16(height),
    be16(width),
    3,
    [1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
  );
/** An APP1 EXIF segment holding only an orientation tag, in big-endian ("MM") or little-endian ("II") order. */
function exif(orientation: number, order: 'MM' | 'II'): Uint8Array {
  const u16 = order === 'MM' ? be16 : le16;
  const u32 = order === 'MM' ? be32 : le32;
  const value = order === 'MM' ? [...be16(orientation), 0, 0] : [...le16(orientation), 0, 0];
  const tiff = bytes(order, u16(42), u32(8), u16(1), u16(0x0112), u16(3), u32(1), value, u32(0));
  return bytes([0xff, 0xe1], be16(2 + 6 + tiff.length), 'Exif\0\0', [...tiff]);
}
const jpeg = (...segments: Uint8Array[]) =>
  bytes([0xff, 0xd8], ...segments.map((s) => [...s]), [0xff, 0xd9]);

const riff = (chunk: string, body: readonly number[]) =>
  bytes('RIFF', le32(4 + 8 + body.length), 'WEBP', chunk, le32(body.length), body);

describe('readImageSize', () => {
  it('reads PNG and GIF sizes', () => {
    expect(readImageSize(png(800, 600))).toEqual({ width: 800, height: 600 });
    expect(readImageSize(png(70_000, 3))).toEqual({ width: 70_000, height: 3 });
    expect(readImageSize(bytes('GIF89a', le16(320), le16(240), [0, 0, 0]))).toEqual({
      width: 320,
      height: 240,
    });
    expect(readImageSize(bytes('GIF87a', le16(1), le16(2)))).toEqual({ width: 1, height: 2 });
  });

  it('reads JPEG sizes from baseline and progressive frames, skipping other segments and fill bytes', () => {
    expect(readImageSize(jpeg(jfif, sof(0xc0, 1024, 768)))).toEqual({ width: 1024, height: 768 });
    expect(readImageSize(jpeg(jfif, bytes([0xff, 0xff]), sof(0xc2, 640, 480)))).toEqual({
      width: 640,
      height: 480,
    });
    const huffman = bytes([0xff, 0xc4], be16(4), [0, 0]); // C4 is in the frame range but isn't a frame
    expect(readImageSize(jpeg(huffman, sof(0xc1, 10, 20)))).toEqual({ width: 10, height: 20 });
  });

  it('swaps width and height for JPEGs the camera marked as turned a quarter', () => {
    for (const order of ['MM', 'II'] as const) {
      expect(readImageSize(jpeg(exif(6, order), sof(0xc0, 4000, 3000)))).toEqual({
        width: 3000,
        height: 4000,
      });
      expect(readImageSize(jpeg(exif(8, order), sof(0xc0, 4000, 3000)))).toEqual({
        width: 3000,
        height: 4000,
      });
      expect(readImageSize(jpeg(exif(3, order), sof(0xc0, 4000, 3000)))).toEqual({
        width: 4000,
        height: 3000,
      });
    }
    expect(readImageSize(jpeg(exif(42, 'MM'), sof(0xc0, 40, 30)))).toEqual({
      width: 40,
      height: 30,
    }); // not a real orientation
  });

  it('reads lossy, lossless and extended WebP sizes', () => {
    expect(
      readImageSize(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(1920), ...le16(1080), 0, 0])),
    ).toEqual({
      width: 1920,
      height: 1080,
    });
    const bits = 500 - 1 + (300 - 1) * 2 ** 14;
    expect(readImageSize(riff('VP8L', [0x2f, ...le32(bits), 0]))).toEqual({
      width: 500,
      height: 300,
    });
    expect(readImageSize(riff('VP8X', [0x10, 0, 0, 0, ...le24(4095), ...le24(2047)]))).toEqual({
      width: 4096,
      height: 2048,
    });
  });

  it('returns null for damaged pictures and other files', () => {
    expect(readImageSize(bytes('\x89PNG\r\n\x1a\n', be32(13), 'IDAT'))).toBeNull();
    expect(readImageSize(png(0, 600))).toBeNull();
    expect(readImageSize(jpeg(jfif))).toBeNull(); // no frame before the end
    expect(readImageSize(bytes([0xff, 0xd8], [0xff, 0xda], be16(2)))).toBeNull(); // picture data before any size
    expect(readImageSize(bytes([0xff, 0xd8, 0x00, 0x00, 0x00, 0x00]))).toBeNull();
    expect(readImageSize(bytes([0xff, 0xd8], [0xff, 0xc0], be16(17), 8))).toBeNull(); // cut short
    expect(readImageSize(riff('VP8 ', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(readImageSize(bytes('%PDF-1.7'))).toBeNull();
    expect(readImageSize(new Uint8Array())).toBeNull();
  });
});
