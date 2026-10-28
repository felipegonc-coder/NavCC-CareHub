// Pictures' location and camera details (Import and export spec, section 3.1; IE-09), with one
// rule for imports and uploads (Data settings, section 3.3): a picture keeps how it looks, which
// way up it is and its colour profile, and nothing else of its EXIF, XMP or IPTC data.
// - JPEG, PNG, WebP and GIF files are rebuilt from the parts that are kept, up to the end of the
//   first picture: a JPEG's extra pictures and a motion photo's video are left out. A JPEG keeps
//   its orientation in an EXIF block that holds nothing else; PNG and WebP lose their EXIF whole,
//   and of a GIF's application extensions only looping stays.
// - HEIC and AVIF files keep their format and are changed in place: every EXIF and XMP item is
//   blanked, the thumbnails' and other pictures' included. Orientation (irot, imir) and colour
//   (colr) are item properties, which stay.
// - A picture that can't be read safely is refused rather than stored as it is, and so are TIFF
//   files (most camera raw files among them), other raw files, JPEG XL and JPEG 2000, which
//   aren't cleaned (REFUSED).
// It imports nothing, so the files service can use the same rule.

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

const viewOf = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The picture doesn't read as its format says, so it's refused. */
class Unreadable extends Error {}

function check(ok: boolean): asserts ok {
  if (!ok) throw new Unreadable();
}

const EXIF = 'Exif\0\0';
const ORIENTATION = 0x0112;

/**
 * The orientation (1 to 8) that EXIF's TIFF data from `tiff` to `end` gives, if any. Only the
 * first directory is read, so no pointer is followed.
 */
function orientationOf(bytes: Uint8Array, tiff: number, end: number): number | null {
  if (end - tiff < 8) return null;
  const view = viewOf(bytes);
  const order = ascii(bytes, tiff, 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return null;
  const u16 = (at: number) => view.getUint16(at, little);
  if (u16(tiff + 2) !== 42) return null;
  const first = tiff + view.getUint32(tiff + 4, little);
  if (first + 2 > end) return null;
  for (let index = 0; index < u16(first); index += 1) {
    const entry = first + 2 + index * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) !== ORIENTATION) continue;
    const value = u16(entry + 2) === 3 ? u16(entry + 8) : 0;
    return value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

/** A JPEG EXIF block with nothing in it but the orientation. */
function orientationBlock(orientation: number): Uint8Array {
  // Little-endian TIFF data: its header, then one directory with one SHORT field and no next.
  const tiff = [0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0];
  const body = [...EXIF].map((char) => char.charCodeAt(0));
  body.push(...tiff, orientation, 0, 0, 0, 0, 0, 0, 0);
  return Uint8Array.from([0xff, 0xe1, 0, body.length + 2, ...body]);
}

/** Where a JPEG's image data from `from` ends: at the next marker other than RST0 to RST7. */
function scanEnd(bytes: Uint8Array, from: number): number {
  let at = bytes.indexOf(0xff, from);
  while (at >= 0 && at + 1 < bytes.length) {
    const next = bytes[at + 1] ?? 0;
    // 0xFF 0x00 is a 0xFF byte of the image data.
    if (next !== 0 && (next < 0xd0 || next > 0xd7)) return at;
    at = bytes.indexOf(0xff, at + 2);
  }
  return bytes.length;
}

function jpeg(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let exif = false;
  let at = 2;
  for (;;) {
    check(bytes[at] === 0xff);
    // Fill bytes may come before a marker.
    while (bytes[at + 1] === 0xff) at += 1;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xd9 || marker === 0x01) {
      parts.push(bytes.subarray(at, at + 2));
      // After the first picture's end come other pictures and videos: they're left out.
      if (marker === 0xd9) break;
      at += 2;
      continue;
    }
    check(marker < 0xd0 || marker > 0xd8);
    const end = at + 2 + (((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0));
    check(end >= at + 4 && end <= bytes.length);
    const block = bytes.subarray(at, end);
    const says = (text: string) => ascii(block, 4, text.length) === text;
    if (marker === 0xe1 && says(EXIF) && !exif) {
      exif = true;
      const orientation = orientationOf(block, 4 + EXIF.length, block.length);
      if (orientation) parts.push(orientationBlock(orientation));
    } else if (
      (marker === 0xe0 && says('JFIF\0')) ||
      (marker === 0xe2 && says('ICC_PROFILE\0')) ||
      (marker === 0xee && says('Adobe')) ||
      // Other APPn blocks (XMP, MPF, IPTC, Photoshop and makers' data) and comments go.
      ((marker < 0xe0 || marker > 0xef) && marker !== 0xfe)
    ) {
      parts.push(block);
    }
    at = end;
    if (marker === 0xda) {
      const stop = scanEnd(bytes, at);
      parts.push(bytes.subarray(at, stop));
      // A picture cut short ends with its image data.
      if (stop === bytes.length) break;
      at = stop;
    }
  }
  return concat(parts);
}

/** PNG chunks kept besides the picture's own: transparency, colour and its profile, animation. */
const PNG_KEPT = new Set(
  'tRNS cHRM gAMA iCCP sBIT sRGB cICP mDCV cLLI bKGD hIST pHYs sPLT acTL fcTL fdAT'.split(' '),
);

function png(bytes: Uint8Array): Uint8Array {
  const view = viewOf(bytes);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  for (;;) {
    check(at + 12 <= bytes.length);
    const end = at + 12 + view.getUint32(at);
    check(end <= bytes.length);
    const type = ascii(bytes, at + 4, 4);
    // Chunks named with a capital first are the picture itself. Text (XMP and raw profiles
    // among it), eXIf and tIME go.
    if (((bytes[at + 4] ?? 0) & 0x20) === 0 || PNG_KEPT.has(type)) {
      parts.push(bytes.subarray(at, end));
    }
    at = end;
    if (type === 'IEND') break;
  }
  return concat(parts);
}

/** WebP chunks that are kept: the picture, its alpha, animation and colour profile. */
const WEBP_KEPT = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
/** VP8X's flags for EXIF and XMP chunks. */
const WEBP_METADATA = 0x08 | 0x04;

function webp(bytes: Uint8Array): Uint8Array {
  const view = viewOf(bytes);
  const end = 8 + view.getUint32(4, true);
  check(end <= bytes.length);
  const parts: Uint8Array[] = [bytes.slice(0, 12)];
  let at = 12;
  while (at < end) {
    check(at + 8 <= end);
    const length = view.getUint32(at + 4, true);
    check(at + 8 + length <= end);
    const type = ascii(bytes, at, 4);
    // Each chunk is padded to an even length.
    const next = Math.min(at + 8 + length + (length % 2), end);
    if (WEBP_KEPT.has(type)) {
      const chunk = bytes.slice(at, next);
      if (type === 'VP8X' && chunk.length > 8) chunk[8] = (chunk[8] ?? 0) & ~WEBP_METADATA;
      parts.push(chunk);
    }
    at = next;
  }
  const out = concat(parts);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

/** The one GIF application extension that's kept: looping. XMP, among others, is in another. */
const GIF_LOOPING = 'NETSCAPE2.0';

function gif(bytes: Uint8Array): Uint8Array {
  const table = (flags: number) => (flags & 0x80 ? 3 << ((flags & 7) + 1) : 0);
  let at = 13 + table(bytes[10] ?? 0);
  check(at <= bytes.length);
  const parts: Uint8Array[] = [bytes.subarray(0, at)];
  /** Where the sub-blocks from `from` end, after the empty one. */
  const blocksEnd = (from: number) => {
    let end = from;
    for (let size = -1; size !== 0; end += 1 + size) {
      check(end < bytes.length);
      size = bytes[end] ?? 0;
    }
    check(end <= bytes.length);
    return end;
  };
  for (;;) {
    const kind = bytes[at];
    if (kind === 0x3b) {
      // The trailer: anything after it is left out.
      parts.push(bytes.subarray(at, at + 1));
      break;
    }
    check(kind === 0x21 || kind === 0x2c);
    if (kind === 0x2c) {
      check(at + 10 <= bytes.length);
      // The picture: its descriptor and colours, the LZW code size, then its data.
      const end = blocksEnd(at + 11 + table(bytes[at + 9] ?? 0));
      parts.push(bytes.subarray(at, end));
      at = end;
      continue;
    }
    const label = bytes[at + 1];
    const end = blocksEnd(at + 2);
    const loops =
      label === 0xff && bytes[at + 2] === 11 && ascii(bytes, at + 3, 11) === GIF_LOOPING;
    // Timing and transparency, and plain text, are part of the picture; comments go.
    if (label === 0xf9 || label === 0x01 || loops) parts.push(bytes.subarray(at, end));
    at = end;
  }
  return concat(parts);
}

/** At most this many boxes are read at each level of a HEIF file, and items and their parts. */
const HEIF_MAX = 10_000;

interface Box {
  type: string;
  /** Where its content starts and ends. */
  start: number;
  end: number;
}

/** The ISO BMFF boxes (HEIC, AVIF) from `start` to `end`, up to the first that doesn't fit. */
function boxesOf(bytes: Uint8Array, start: number, end: number): Box[] {
  const view = viewOf(bytes);
  const boxes: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    check(boxes.length < HEIF_MAX);
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1 && at + 16 <= end) {
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || at + size > end) break;
    boxes.push({ type: ascii(bytes, at + 4, 4), start: at + header, end: at + size });
    at += size;
  }
  return boxes;
}

/** HEIF's brands, HEIC's and AVIF's among them. */
const HEIF_BRANDS = new Set('heic heix heim heis hevc hevx mif1 msf1 avif avis'.split(' '));

/** Whether the file starts with an ftyp box naming a HEIF brand (HEIC or AVIF among them). */
function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return false;
  const end = Math.min(viewOf(bytes).getUint32(0), bytes.length);
  // The major brand, then the minor version, then the compatible brands.
  if (HEIF_BRANDS.has(ascii(bytes, 8, 4))) return true;
  for (let at = 16; at + 4 <= end; at += 4) if (HEIF_BRANDS.has(ascii(bytes, at, 4))) return true;
  return false;
}

/** Each item's type from the meta box's iinf, with XMP's `mime` items as `xmp`. */
function itemTypes(bytes: Uint8Array, iinf: Box): Map<number, string> {
  const view = viewOf(bytes);
  const types = new Map<number, string>();
  const entries = boxesOf(bytes, iinf.start + (bytes[iinf.start] === 0 ? 6 : 8), iinf.end);
  for (const infe of entries) {
    if (infe.type !== 'infe') continue;
    const version = bytes[infe.start] ?? 0;
    const idSize = version === 2 ? 2 : 4;
    // Older item entries have no type, so what they hold can't be told.
    check(version >= 2 && infe.start + 10 + idSize <= infe.end);
    const id = idSize === 2 ? view.getUint16(infe.start + 4) : view.getUint32(infe.start + 4);
    const at = infe.start + 6 + idSize;
    const type = ascii(bytes, at, 4);
    // A mime item: its name, then its content type, each ending with a zero.
    const name = bytes.subarray(at + 4, infe.end).indexOf(0);
    const from = at + 5 + name;
    const content = name < 0 ? '' : ascii(bytes, from, Math.min(infe.end - from, 64));
    const xmp = type === 'mime' && content.startsWith('application/rdf+xml');
    types.set(id, xmp ? 'xmp' : type);
  }
  return types;
}

/**
 * Where each item's data is, from the meta box's iloc: its parts' starts and ends in the file, or
 * null when it's built from other items (construction method 2) and can't be told. Items in
 * other files are left out.
 */
function itemParts(bytes: Uint8Array, iloc: Box, idat?: Box) {
  const view = viewOf(bytes);
  const version = bytes[iloc.start] ?? 0;
  let at = iloc.start + 4;
  const readers: Record<number, (from: number) => number> = {
    0: () => 0,
    2: (from) => view.getUint16(from),
    4: (from) => view.getUint32(from),
    8: (from) => Number(view.getBigUint64(from)),
  };
  /** The next number of `size` bytes. */
  const take = (size: number): number => {
    const read = readers[size];
    check(read !== undefined && at + size <= iloc.end);
    at += size;
    return read(at - size);
  };
  const sizes = take(2);
  const indexSize = version === 0 ? 0 : sizes & 15;
  const parts = new Map<number, [number, number][] | null>();
  const items = take(version < 2 ? 2 : 4);
  check(items <= HEIF_MAX);
  let extentsRead = 0;
  for (let item = 0; item < items; item += 1) {
    const id = take(version < 2 ? 2 : 4);
    const method = version === 0 ? 0 : take(2) & 15;
    const here = take(2) === 0;
    const base = take((sizes >> 4) & 15);
    const extents: [number, number][] = [];
    for (let count = take(2); count > 0; count -= 1) {
      // Sizes of 0 read nothing, so the number of parts is capped too.
      extentsRead += 1;
      check(extentsRead <= HEIF_MAX);
      take(indexSize);
      extents.push([base + take(sizes >> 12), take((sizes >> 8) & 15)]);
    }
    if (!here) continue;
    const within = method === 0 ? { start: 0, end: bytes.length } : method === 1 ? idat : null;
    check(within !== undefined);
    // A length of 0 runs to the end.
    const ranges = extents.map(([offset, length]): [number, number] => {
      const start = within ? within.start + offset : 0;
      return [start, length === 0 && within ? within.end : start + length];
    });
    parts.set(id, within ? ranges : null);
  }
  return parts;
}

function heif(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  const meta = boxesOf(copy, 0, copy.length).find((box) => box.type === 'meta');
  const inner = meta ? boxesOf(copy, meta.start + 4, meta.end) : [];
  const find = (type: string) => inner.find((box) => box.type === type);
  const iinf = find('iinf');
  const iloc = find('iloc');
  check(iinf !== undefined && iloc !== undefined);
  const parts = itemParts(copy, iloc, find('idat'));
  for (const [id, type] of itemTypes(copy, iinf)) {
    if (type !== 'Exif' && type !== 'xmp') continue;
    const ranges = parts.get(id);
    check(ranges !== null);
    for (const [start, end] of ranges ?? []) {
      check(start <= end && end <= copy.length);
      copy.fill(type === 'xmp' ? 0x20 : 0, start, end);
    }
  }
  return copy;
}

/** Pictures that are refused, by their first bytes. */
const REFUSED = [
  // TIFF and BigTIFF, with most cameras' raw files.
  /^(?:II[*+]\0|MM\0[*+])/,
  // Olympus's, Panasonic's, Fujifilm's and Canon's raw files.
  /^(?:II(?:RO|RS|U\0)|MMOR|FUJIFILMCCD-RAW|.{4}ftypcrx )/s,
  // JPEG XL, on its own (0xFF 0x0A) or in its boxes, and JPEG 2000.
  /^(?:\xff\n|\0\0\0\f(?:JXL |jP {2})\r\n\x87\n)/,
];

/** What kind of picture the file is, from its first bytes. */
function pictureKind(bytes: Uint8Array) {
  const start = ascii(bytes, 0, 16);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return jpeg;
  if (start.startsWith('\x89PNG\r\n\x1a\n')) return png;
  if (start.startsWith('RIFF') && start.slice(8, 12) === 'WEBP') return webp;
  if (start.startsWith('GIF87a') || start.startsWith('GIF89a')) return gif;
  if (REFUSED.some((pattern) => pattern.test(start))) return 'refused';
  if (isHeif(bytes)) return heif;
  return null;
}

/**
 * The picture without its location and camera details, when it's a JPEG, PNG, WebP, GIF, HEIC or
 * AVIF picture; null when it's a picture that can't be read safely, or one that's refused
 * (REFUSED). Any other file comes back as it is. The bytes it's given aren't changed.
 */
export function withoutLocation(bytes: Uint8Array): Uint8Array | null {
  try {
    const clean = pictureKind(bytes);
    if (clean === 'refused') return null;
    return clean ? clean(bytes) : bytes;
  } catch (error) {
    if (error instanceof Unreadable || error instanceof RangeError) return null;
    throw error;
  }
}
