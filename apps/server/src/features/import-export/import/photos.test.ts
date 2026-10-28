import { describe, expect, it } from 'vitest';
import { withoutLocation } from './photos';

type Part = string | readonly number[] | Uint8Array;
const join = (...parts: Part[]) =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === 'string' ? [...part].map((char) => char.charCodeAt(0)) : [...part],
    ),
  );
const u16 = (n: number) => [n >> 8, n & 0xff];
const u32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];

/** Where the GPS directory starts in `tiff()`. */
const GPS = 38;

/** TIFF data with an orientation of 6, and GPS fields saying N 39° 44′. */
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
  return join([0xff, marker, ...u16(body.length + 2)], body);
};
const IMAGE_DATA = [0xff, 0xda, 0, 4, 1, 2, 0xaa, 0xbb, 0xff, 0xd9];
const xmpBlock = (xmp: string) => segment(0xe1, 'http://ns.adobe.com/xap/1.0/\0', xmp);

/** The EXIF block a JPEG keeps: the orientation and nothing else. */
const orientation = (n: number) =>
  segment(
    0xe1,
    'Exif\0\0',
    'II',
    [42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0],
    [n, 0, 0, 0],
    [0, 0, 0, 0],
  );

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const chunk = (type: string, ...data: Part[]) => {
  const body = join(...data);
  return join(u32(body.length), type, body, [1, 2, 3, 4]);
};

const riff = (type: string, ...data: Part[]) => {
  const body = join(...data);
  return join(type, le32(body.length), body, body.length % 2 ? [0] : []);
};
const webpOf = (...chunks: Uint8Array[]) => {
  const body = join('WEBP', ...chunks);
  return join('RIFF', le32(body.length), body);
};

const box = (type: string, ...data: Part[]) => {
  const body = join(...data);
  return join(u32(body.length + 8), type, body);
};
/** A box with a version and flags. */
const full = (type: string, version: number, ...data: Part[]) =>
  box(type, [version, 0, 0, 0], ...data);

interface Item {
  type: string;
  data: Part;
  /** How it's stored: in mdat (0, the default), in the meta box's idat (1), or from items (2). */
  method?: number;
  contentType?: string;
  /** Stored in two parts. */
  split?: boolean;
}

/** A HEIF picture (HEIC or AVIF) with these items, numbered from 1. */
function heif(brand: string, items: readonly Item[], infeVersion = 2): Uint8Array {
  const datas = items.map((item) => join(item.data));
  const inIdat = (index: number) => items[index]?.method === 1;
  const meta = (mdat: number) => {
    const next = { idat: 0, mdat };
    const locations = datas.map((data, index) => {
      const where = inIdat(index) ? 'idat' : 'mdat';
      const start = next[where];
      next[where] += data.length;
      const half = items[index]?.split ? data.length >> 1 : data.length;
      const parts = [[start, half]];
      if (half < data.length) parts.push([start + half, data.length - half]);
      const extents = parts.flatMap(([offset = 0, length = 0]) => [...u32(offset), ...u32(length)]);
      return join(
        u16(index + 1),
        u16(items[index]?.method ?? 0),
        u16(0),
        u16(parts.length),
        extents,
      );
    });
    const entries = items.map((item, index) =>
      full('infe', infeVersion, u16(index + 1), u16(0), item.type, '\0', item.contentType ?? ''),
    );
    return full(
      'meta',
      0,
      full('hdlr', 0, u32(0), 'pict', u32(0), u32(0), u32(0), '\0'),
      full('iinf', 0, u16(items.length), ...entries),
      // 4-byte offsets and lengths; each item's id, how it's stored, its file (0: this one), parts.
      full('iloc', 1, [0x44, 0], u16(items.length), ...locations),
      box('idat', ...datas.filter((_, index) => inIdat(index))),
    );
  };
  const ftyp = box('ftyp', brand, u32(0), 'mif1', brand);
  const mdat = datas.filter((_, index) => !inIdat(index));
  return join(ftyp, meta(ftyp.length + meta(0).length + 8), box('mdat', ...mdat));
}
const exifItem = (data: Uint8Array) => join(u32(6), 'Exif\0\0', data);

describe("pictures' location and camera details", () => {
  it("keeps a JPEG's picture, colour profile and orientation, and none of its other data", () => {
    const jfif = segment(0xe0, 'JFIF\0', [1, 2]);
    const profile = segment(0xe2, 'ICC_PROFILE\0', [1, 1], 'profile');
    const adobe = segment(0xee, 'Adobe', [0, 100, 0, 0, 0, 0, 1]);
    const tables = segment(0xdb, [0, 1, 2, 3]);
    const photo = join(
      [0xff, 0xd8],
      jfif,
      segment(0xe1, 'Exif\0\0', tiff(false)),
      segment(0xe1, 'Exif\0\0', 'II*\0', [8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 8, 0]),
      xmpBlock('<x:xmpmeta exif:GPSLatitude="39,44N"/>'),
      segment(0xe1, 'http://ns.adobe.com/xmp/extension/\0', 'more'),
      profile,
      segment(0xe2, 'MPF\0', 'MM\0*'),
      segment(0xed, 'Photoshop 3.0\0', '8BIM', [4, 4]),
      segment(0xeb, 'maker notes'),
      segment(0xfe, 'Taken at the clinic'),
      adobe,
      tables,
      IMAGE_DATA,
    );
    expect(withoutLocation(photo)).toEqual(
      join([0xff, 0xd8], jfif, orientation(6), profile, adobe, tables, IMAGE_DATA),
    );
  });

  it("leaves out a JPEG's EXIF without an orientation, and reads only its first directory", () => {
    const gpsOnly = join('II*\0', [8, 0, 0, 0, 1, 0, 0x25, 0x88, 4, 0, 1, 0, 0, 0, 26, 0, 0, 0]);
    const damaged = join('II*\0', [200, 0, 0, 0]);
    for (const exif of [gpsOnly, damaged]) {
      const photo = join([0xff, 0xd8], segment(0xe1, 'Exif\0\0', exif), IMAGE_DATA);
      expect(withoutLocation(photo)).toEqual(join([0xff, 0xd8], IMAGE_DATA));
    }
    // A directory whose next one is itself.
    const looping = join('II*\0', [8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 3, 0, 0, 0, 8, 0]);
    const photo = join([0xff, 0xd8], segment(0xe1, 'Exif\0\0', looping, [0, 0]), IMAGE_DATA);
    expect(withoutLocation(photo)).toEqual(join([0xff, 0xd8], orientation(3), IMAGE_DATA));
  });

  it("stops at the end of a JPEG's first picture, so its other pictures and video go", () => {
    const second = join([0xff, 0xd8], segment(0xe1, 'Exif\0\0', tiff(true)), IMAGE_DATA);
    const first = join([0xff, 0xd8], segment(0xe2, 'MPF\0', 'II*\0'), IMAGE_DATA);
    expect(withoutLocation(join(first, second))).toEqual(join([0xff, 0xd8], IMAGE_DATA));
    const video = join(box('ftyp', 'mp42', u32(0), 'isom'), box('mdat', 'frames'));
    const motion = join([0xff, 0xd8], xmpBlock('<Camera:MotionPhoto>1</Camera:MotionPhoto>'));
    expect(withoutLocation(join(motion, IMAGE_DATA, video))).toEqual(
      join([0xff, 0xd8], IMAGE_DATA),
    );
  });

  it("reads a JPEG's image data through restart markers, fill bytes and later scans", () => {
    const frame = segment(0xc2, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
    const scan = [0xff, 0xda, 0, 4, 1, 2, 0x11, 0xff, 0, 0x22, 0xff, 0xd0, 0x33, 0xff, 0xd7, 0x44];
    const huffman = segment(0xc4, [0, 1, 2]);
    const photo = join(
      [0xff, 0xd8],
      frame,
      scan,
      [0xff, 0xff],
      huffman,
      scan,
      segment(0xfe, 'Second pass'),
      scan,
      [0xff, 0xd9],
    );
    expect(withoutLocation(photo)).toEqual(
      join([0xff, 0xd8], frame, scan, huffman, scan, scan, [0xff, 0xd9]),
    );
    const cut = [0xff, 0xda, 0, 4, 1, 2, 0xaa, 0xbb];
    expect(withoutLocation(join([0xff, 0xd8], segment(0xfe, 'Lobby'), cut))).toEqual(
      join([0xff, 0xd8], cut),
    );
  });

  it("refuses a JPEG it can't read", () => {
    for (const damaged of [
      join([0xff, 0xd8], [0xff, 0xe1, 0, 200, 1]),
      join([0xff, 0xd8], [0xff, 0xe1, 0, 1]),
      join([0xff, 0xd8], segment(0xdb, [0]), [0], IMAGE_DATA),
      join([0xff, 0xd8], [0xff, 0xd0], IMAGE_DATA),
      join([0xff, 0xd8], [0xff, 0xd8], IMAGE_DATA),
      join([0xff, 0xd8], segment(0xdb, [0])),
    ]) {
      expect(withoutLocation(damaged)).toBeNull();
    }
  });

  it("keeps a PNG's picture, transparency, colour and animation, but not its text or EXIF", () => {
    const header = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    const profile = chunk('iCCP', 'ICC\0\0', [0x78, 0x9c]);
    const kept = [
      chunk('sRGB', [0]),
      chunk('gAMA', u32(45455)),
      chunk('acTL', u32(1), u32(0)),
      chunk('fcTL', u32(0), u32(1), u32(1)),
      chunk('tRNS', [0, 0]),
    ];
    const pixels = chunk('IDAT', [1, 2, 3]);
    const end = chunk('IEND');
    const photo = join(
      SIGNATURE,
      header,
      chunk('eXIf', tiff(false)),
      profile,
      chunk('iTXt', 'XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>'),
      chunk('zTXt', 'Raw profile type exif\0\0', [0x78, 0x9c, 1, 2]),
      chunk('tEXt', 'Comment\0Front desk'),
      chunk('tIME', [7, 234, 10, 28, 6, 0, 0]),
      ...kept,
      chunk('vpAg', [1]),
      pixels,
      end,
      'more after the end',
    );
    expect(withoutLocation(photo)).toEqual(join(SIGNATURE, header, profile, ...kept, pixels, end));
  });

  it("refuses a PNG that's damaged or cut short", () => {
    const header = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    expect(withoutLocation(join(SIGNATURE, header, chunk('IDAT', [1])))).toBeNull();
    expect(withoutLocation(join(SIGNATURE, header, u32(200), 'IDAT', [1, 2]))).toBeNull();
  });

  it("keeps a WebP's picture and colour profile, without its EXIF and XMP", () => {
    const profile = riff('ICCP', 'profile');
    const alpha = riff('ALPH', [9]);
    const pixels = riff('VP8L', [1, 2, 3]);
    const photo = join(
      webpOf(
        riff('VP8X', [0x20 | 0x10 | 0x08 | 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        profile,
        alpha,
        pixels,
        riff('EXIF', tiff(true)),
        riff('XMP ', '<x:xmpmeta/>'),
        riff('ABCD', [1]),
      ),
      'more after the end',
    );
    const before = photo.slice();
    expect(withoutLocation(photo)).toEqual(
      webpOf(riff('VP8X', [0x20 | 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0]), profile, alpha, pixels),
    );
    expect(photo).toEqual(before);
  });

  it("refuses a WebP that's damaged or cut short", () => {
    const photo = webpOf(riff('VP8L', [1, 2, 3]));
    expect(withoutLocation(photo.subarray(0, photo.length - 2))).toBeNull();
    expect(withoutLocation(webpOf(join('VP8L', le32(100), [1, 2])))).toBeNull();
  });

  it("keeps a GIF's frames, timing and looping, but not comments or other extensions", () => {
    const screen = join('GIF89a', [1, 0, 1, 0, 0x80, 0, 0], [0, 0, 0, 255, 255, 255]);
    const loop = join([0x21, 0xff, 11], 'NETSCAPE2.0', [3, 1, 0, 0, 0]);
    const timing = [0x21, 0xf9, 4, 4, 10, 0, 0, 0];
    const frame = join([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0], [2, 2, 0x4c, 0x01, 0]);
    const photo = join(
      screen,
      loop,
      join([0x21, 0xfe, 11], 'Front desk.', [0]),
      join([0x21, 0xff, 11], 'XMP DataXMP', [4], '<x/>', [0]),
      join([0x21, 0xff, 11], 'ICCRGBG1012', [4, 1, 2, 3, 4, 0]),
      timing,
      frame,
      timing,
      frame,
      [0x3b],
      'more after the end',
    );
    expect(withoutLocation(photo)).toEqual(
      join(screen, loop, timing, frame, timing, frame, [0x3b]),
    );
  });

  it("refuses a GIF that's damaged or cut short", () => {
    const screen = join('GIF89a', [1, 0, 1, 0, 0, 0, 0]);
    const frame = join([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0], [2, 2, 0x4c, 0x01, 0]);
    expect(withoutLocation(join(screen, frame))).toBeNull();
    expect(withoutLocation(join(screen, [0], [0x3b]))).toBeNull();
    expect(withoutLocation(join(screen, [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 9, 1]))).toBeNull();
  });

  it('blanks every EXIF and XMP item of HEIC and AVIF pictures, in place', () => {
    const xmp = '<x:xmpmeta><exif:GPSLatitude>39,44N</exif:GPSLatitude></x:xmpmeta>';
    const exif = exifItem(tiff(false));
    const thumbnail = exifItem(tiff(true));
    const photo = (brand: string, own: Part, small: Part, packet: Part) =>
      heif(brand, [
        { type: brand === 'avif' ? 'av01' : 'hvc1', data: [1, 2, 3, 4] },
        { type: 'Exif', data: own, method: 1, split: true },
        { type: 'Exif', data: small },
        { type: 'mime', data: packet, contentType: 'application/rdf+xml\0' },
        { type: 'mime', data: 'Front desk', contentType: 'text/plain\0' },
      ]);
    for (const brand of ['heic', 'avif']) {
      const before = photo(brand, exif, thumbnail, xmp);
      const blank = (part: Uint8Array) => new Uint8Array(part.length);
      expect(withoutLocation(before)).toEqual(
        photo(brand, blank(exif), blank(thumbnail), ' '.repeat(xmp.length)),
      );
      expect(before).toEqual(photo(brand, exif, thumbnail, xmp));
    }
  });

  it("refuses a HEIC or AVIF picture it can't read safely", () => {
    const exif = { type: 'Exif', data: exifItem(tiff(true)) };
    const picture = { type: 'hvc1', data: [1, 2, 3, 4] };
    const photo = heif('heic', [picture, exif]);
    for (const damaged of [
      // Without its meta box, where its items are listed.
      join(box('ftyp', 'heic', u32(0), 'mif1', 'heic'), box('mdat', exif.data)),
      // Item entries too old to say what they are.
      heif('heic', [picture, exif], 1),
      // EXIF made from other items.
      heif('avif', [picture, { ...exif, method: 2 }]),
      // Cut short.
      photo.subarray(0, photo.length - 4),
    ]) {
      expect(withoutLocation(damaged)).toBeNull();
    }
  });

  it("refuses TIFF files and other pictures it doesn't clean, camera raw files among them", () => {
    // Two pages, the second with GPS fields, and a page whose next page is itself.
    const pages = join(
      'II*\0',
      [8, 0, 0, 0, 1, 0, 0, 1, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0],
    );
    const looping = join(
      'MM\0*',
      [0, 0, 0, 8, 0, 1, 1, 0, 0, 3, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 8],
    );
    const signature = [0x0d, 0x0a, 0x87, 0x0a];
    for (const picture of [
      tiff(true),
      tiff(false),
      join(pages, [1, 0, 0x25, 0x88, 4, 0, 1, 0, 0, 0, 44, 0, 0, 0, 0, 0, 0, 0]),
      looping,
      join('II+\0', [8, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0]),
      join('IIRO', [8, 0, 0, 0]),
      join('IIU\0', [8, 0, 0, 0]),
      join('FUJIFILMCCD-RAW 0201'),
      box('ftyp', 'crx ', u32(1), 'crx ', 'isom'),
      join([0xff, 0x0a, 0xfa, 0x1f]),
      join(u32(12), 'JXL ', signature, box('ftyp', 'jxl ', u32(0), 'jxl ')),
      join(u32(12), 'jP  ', signature, box('ftyp', 'jp2 ', u32(0), 'jp2 ')),
    ]) {
      expect(withoutLocation(picture)).toBeNull();
    }
  });

  it('leaves other files as they are', () => {
    for (const file of [
      join('%PDF-1.7 Exif'),
      join(box('ftyp', 'isom', u32(0), 'isom', 'mp42'), box('moov', 'GPS')),
      join('# Visit notes\n'),
      join([0xff, 0xd8]),
      new Uint8Array(),
    ]) {
      expect(withoutLocation(file)).toBe(file);
    }
  });
});
