import { byteAt, hasAscii, u16be, u16le, u24le, u32be, u32le } from './bytes';

/** A width and height in pixels. */
export type PixelSize = { width: number; height: number };

/**
 * Width and height of a PNG, JPEG, GIF or WebP picture, read from its bytes, as people see it: a JPEG that the
 * camera marked as rotated a quarter turn has its width and height swapped. Null when the size can't be read.
 */
export function readImageSize(bytes: Uint8Array): PixelSize | null {
  const b = bytes;
  let size: PixelSize | null = null;
  if (hasAscii(b, '\x89PNG\r\n\x1a\n') && hasAscii(b, 'IHDR', 12))
    size = { width: u32be(b, 16), height: u32be(b, 20) };
  else if (hasAscii(b, 'GIF87a') || hasAscii(b, 'GIF89a'))
    size = { width: u16le(b, 6), height: u16le(b, 8) };
  else if (byteAt(b, 0) === 0xff && byteAt(b, 1) === 0xd8) size = jpegSize(b);
  else if (hasAscii(b, 'RIFF') && hasAscii(b, 'WEBP', 8)) size = webpSize(b);
  return size && size.width > 0 && size.height > 0 ? size : null;
}

function webpSize(b: Uint8Array): PixelSize | null {
  if (
    hasAscii(b, 'VP8 ', 12) &&
    byteAt(b, 23) === 0x9d &&
    byteAt(b, 24) === 0x01 &&
    byteAt(b, 25) === 0x2a
  ) {
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (hasAscii(b, 'VP8L', 12) && byteAt(b, 20) === 0x2f) {
    const bits = u32le(b, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (hasAscii(b, 'VP8X', 12)) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return null;
}

// Start-of-frame markers carry the picture size; C4, C8 and CC are other markers in the same range.
const isFrameHeader = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

function jpegSize(b: Uint8Array): PixelSize | null {
  let orientation = 1;
  let i = 2;
  while (i + 4 <= b.length) {
    if (byteAt(b, i) !== 0xff) return null;
    const marker = byteAt(b, i + 1);
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of picture or picture data before any size
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    if (marker === 0xe1 && hasAscii(b, 'Exif\0\0', i + 4))
      orientation = exifOrientation(b, i + 10, i + 2 + length);
    if (isFrameHeader(marker)) {
      if (i + 9 > b.length) return null;
      const height = u16be(b, i + 5);
      const width = u16be(b, i + 7);
      return orientation >= 5 ? { width: height, height: width } : { width, height };
    }
    i += 2 + length;
  }
  return null;
}

/** The EXIF orientation (1..8) in a TIFF structure starting at `start`; 1 when missing or unreadable. */
function exifOrientation(b: Uint8Array, start: number, end: number): number {
  const little = hasAscii(b, 'II', start);
  if (!little && !hasAscii(b, 'MM', start)) return 1;
  const u16 = (at: number) => (little ? u16le(b, at) : u16be(b, at));
  const u32 = (at: number) => (little ? u32le(b, at) : u32be(b, at));
  if (u16(start + 2) !== 42) return 1;
  const ifd = start + u32(start + 4);
  const count = ifd + 2 <= end ? u16(ifd) : 0;
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > end) break;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}
