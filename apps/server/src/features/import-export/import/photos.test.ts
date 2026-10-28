import { describe, expect, it } from 'vitest';
import { withoutLocation } from './photos';

type Part = string | readonly number[] | Uint8Array;
const join = (...parts: Part[]) =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === 'string' ? [...part].map((char) => char.charCodeAt(0)) : [...part],
    ),
  );

/** Where the GPS directory starts in `tiff()`: everything from there on is location. */
const GPS = 38;

/** TIFF data with an orientation, and GPS fields saying N 39° 44′. */
function tiff(little: boolean): Uint8Array {
  const out = new Uint8Array(92);
  const view = new DataView(out.buffer);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    view.setUint16(at, tag, little);
    view.setUint16(at + 2, type, little);
    view.setUint32(at + 4, count, little);
    if (type === 3) view.setUint16(at + 8, value, little);
    else view.setUint32(at + 8, value, little);
  };
  out.set(little ? [0x49, 0x49] : [0x4d, 0x4d]);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, 2, little);
  entry(10, 0x0112, 3, 1, 6);
  entry(22, 0x8825, 4, 1, GPS);
  view.setUint16(GPS, 2, little);
  entry(GPS + 2, 0x0001, 2, 2, 0);
  out.set([0x4e, 0], GPS + 10);
  entry(GPS + 14, 0x0002, 5, 3, 68);
  [39, 1, 44, 1, 0, 1].forEach((n, index) => view.setUint32(68 + index * 4, n, little));
  return out;
}

const segment = (marker: number, ...data: Part[]) => {
  const body = join(...data);
  return join([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff], body);
};
const IMAGE_DATA = [0xff, 0xda, 0, 4, 1, 2, 0xaa, 0xbb, 0xff, 0xd9];

const chunk = (type: string, ...data: Part[]) => {
  const body = join(...data);
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, body.length);
  return join(size, type, body, [1, 2, 3, 4]);
};

const riff = (type: string, ...data: Part[]) => {
  const body = join(...data);
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, body.length, true);
  return join(type, size, body, body.length % 2 ? [0] : []);
};
const webpOf = (...chunks: Uint8Array[]) => {
  const body = join('WEBP', ...chunks);
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, body.length, true);
  return join('RIFF', size, body);
};

describe("photos' location data", () => {
  it('wipes the GPS fields of TIFF data in either byte order, and keeps the rest', () => {
    for (const little of [true, false]) {
      const photo = tiff(little);
      const wiped = withoutLocation(photo);
      expect(wiped.subarray(0, GPS)).toEqual(photo.subarray(0, GPS));
      expect(wiped.subarray(GPS).every((byte) => byte === 0)).toBe(true);
      expect(photo[GPS + 10]).toBe(0x4e);
    }
  });

  it("keeps a JPEG's picture and EXIF, without the GPS fields, XMP or Photoshop data", () => {
    const jfif = segment(0xe0, 'JFIF\0', [1, 2]);
    const tables = segment(0xdb, [0, 1, 2, 3]);
    const photo = join(
      [0xff, 0xd8],
      jfif,
      segment(0xe1, 'Exif\0\0', tiff(true)),
      segment(0xe1, 'http://ns.adobe.com/xap/1.0/\0', '<x:xmpmeta/>'),
      segment(0xed, 'Photoshop 3.0\0', [8, 0, 0]),
      tables,
      IMAGE_DATA,
    );
    const wiped = new Uint8Array(tiff(true));
    wiped.fill(0, GPS);
    expect(withoutLocation(photo)).toEqual(
      join([0xff, 0xd8], jfif, segment(0xe1, 'Exif\0\0', wiped), tables, IMAGE_DATA),
    );
    const damaged = join([0xff, 0xd8], segment(0xe1, 'Exif\0\0', 'II*\0', [200, 0, 0, 0]));
    expect(withoutLocation(join(damaged, IMAGE_DATA))).toEqual(join([0xff, 0xd8], IMAGE_DATA));
  });

  it("leaves out PNG's EXIF and XMP chunks", () => {
    const header = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    const comment = chunk('tEXt', 'Comment\0Front desk');
    const pixels = chunk('IDAT', [1, 2, 3]);
    const end = chunk('IEND');
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const photo = join(
      signature,
      header,
      chunk('eXIf', tiff(false)),
      chunk('iTXt', 'XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>'),
      comment,
      pixels,
      end,
    );
    expect(withoutLocation(photo)).toEqual(join(signature, header, comment, pixels, end));
  });

  it("leaves out WebP's EXIF and XMP chunks, and says so in its header", () => {
    const pixels = riff('VP8L', [1, 2, 3]);
    const photo = webpOf(
      riff('VP8X', [0x10 | 0x08 | 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      pixels,
      riff('EXIF', tiff(true)),
      riff('XMP ', '<x:xmpmeta/>'),
    );
    expect(withoutLocation(photo)).toEqual(
      webpOf(riff('VP8X', [0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0]), pixels),
    );
  });

  it('leaves other files as they are', () => {
    const file = join('%PDF-1.7 Exif');
    expect(withoutLocation(file)).toBe(file);
  });
});
