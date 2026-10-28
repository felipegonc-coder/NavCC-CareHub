// Photos' location data (Import and export spec, section 3.1; IE-09): imported pictures keep how
// they look, but not where they were taken. In JPEG and TIFF files the EXIF GPS fields are wiped,
// so the rest of EXIF (such as which way up the photo is) stays. XMP, which can hold the place
// too, is left out of JPEG, PNG and WebP files, as are JPEG's Photoshop and IPTC data and PNG's
// and WebP's EXIF. A JPEG's EXIF that can't be read safely is left out whole. HEIC and AVIF
// pictures are changed in place, so nothing in them moves: their EXIF items' GPS fields are wiped
// (or the whole item, when it can't be read safely) and their XMP items are blanked.

/** Bytes per value of each TIFF field type, by type number. */
const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
const GPS_POINTER = 0x8825;

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Wipes the GPS fields of the TIFF data in `bytes` from `tiff` to `end`, in place, and empties
 * their directory. False when the data doesn't read as TIFF.
 */
function wipeGps(bytes: Uint8Array, tiff: number, end: number): boolean {
  if (end - tiff < 8) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = ascii(bytes, tiff, 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return false;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(tiff + 2) !== 42) return false;
  const first = tiff + u32(tiff + 4);
  if (first + 2 > end) return false;
  for (let index = 0; index < u16(first); index += 1) {
    const entry = first + 2 + index * 12;
    if (entry + 12 > end) return false;
    if (u16(entry) !== GPS_POINTER) continue;
    const gps = tiff + u32(entry + 8);
    if (gps + 2 > end) return false;
    const fields = u16(gps);
    const stop = gps + 2 + fields * 12 + 4;
    if (stop > end) return false;
    for (let field = 0; field < fields; field += 1) {
      const at = gps + 2 + field * 12;
      const size = (TYPE_SIZES[u16(at + 2)] ?? 1) * u32(at + 4);
      const value = tiff + u32(at + 8);
      if (size <= 4) continue;
      if (value + size > end) return false;
      bytes.fill(0, value, value + size);
    }
    bytes.fill(0, gps, stop);
  }
  return true;
}

const EXIF = 'Exif\0\0';
/** APP1 blocks of XMP, and of XMP too big for one block. */
const XMP = ['http://ns.adobe.com/xap/1.0/\0', 'http://ns.adobe.com/xmp/extension/\0'];

function jpeg(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  // Up to the image data, which starts at SOS (0xDA); the metadata comes before it.
  while (at + 4 <= bytes.length && bytes[at] === 0xff && bytes[at + 1] !== 0xda) {
    const marker = bytes[at + 1] ?? 0;
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    if (length < 2 || at + 2 + length > bytes.length) break;
    const block = bytes.subarray(at, at + 2 + length);
    const says = (text: string) => ascii(block, 4, text.length) === text;
    if (marker === 0xe1 && says(EXIF)) {
      const copy = block.slice();
      if (wipeGps(copy, 4 + EXIF.length, copy.length)) parts.push(copy);
    } else if (!(marker === 0xe1 && XMP.some(says)) && marker !== 0xed) {
      parts.push(block);
    }
    at += 2 + length;
  }
  parts.push(bytes.subarray(at));
  return concat(parts);
}

const XMP_KEYWORD = 'XML:com.adobe.xmp\0';

function png(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const size = 12 + view.getUint32(at);
    if (at + size > bytes.length) break;
    const type = ascii(bytes, at + 4, 4);
    const isXmp = /^[itz]TXt$|^tEXt$/.test(type) && ascii(bytes, at + 8, 18) === XMP_KEYWORD;
    if (type !== 'eXIf' && !isXmp) parts.push(bytes.subarray(at, at + size));
    at += size;
  }
  parts.push(bytes.subarray(at));
  return concat(parts);
}

/** WebP's VP8X flags for EXIF and XMP chunks. */
const WEBP_METADATA = 0x08 | 0x04;

function webp(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.slice(0, 12)];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at + 4, true);
    const size = 8 + length + (length % 2);
    if (at + size > bytes.length) break;
    const type = ascii(bytes, at, 4);
    const chunk = bytes.slice(at, at + size);
    if (type === 'VP8X' && chunk.length > 8) chunk[8] = (chunk[8] ?? 0) & ~WEBP_METADATA;
    if (type !== 'EXIF' && type !== 'XMP ') parts.push(chunk);
    at += size;
  }
  parts.push(bytes.subarray(at));
  const out = concat(parts);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

interface Box {
  type: string;
  /** Where its content starts and ends. */
  start: number;
  end: number;
}

/** The ISO BMFF boxes (HEIC, AVIF) from `start` to `end`, up to the first that doesn't fit. */
function boxesOf(bytes: Uint8Array, start: number, end: number): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
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
  const [ftyp] = ascii(bytes, 4, 4) === 'ftyp' ? boxesOf(bytes, 0, bytes.length) : [];
  if (!ftyp) return false;
  for (let at = ftyp.start; at + 4 <= ftyp.end; at += 4) {
    const brand = ascii(bytes, at, 4);
    // The second four bytes are the minor version.
    if (at !== ftyp.start + 4 && HEIF_BRANDS.has(brand)) return true;
  }
  return false;
}

/** Each item's type from the meta box's iinf, with XMP's `mime` items as `xmp`. */
function itemTypes(bytes: Uint8Array, iinf: Box): Map<number, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types = new Map<number, string>();
  const entries = boxesOf(bytes, iinf.start + (bytes[iinf.start] === 0 ? 6 : 8), iinf.end);
  for (const infe of entries) {
    const version = bytes[infe.start] ?? 0;
    const idSize = version === 2 ? 2 : 4;
    // Older item entries have no type.
    if (infe.type !== 'infe' || version < 2 || infe.start + 10 + idSize > infe.end) continue;
    const id = idSize === 2 ? view.getUint16(infe.start + 4) : view.getUint32(infe.start + 4);
    const at = infe.start + 6 + idSize;
    const type = ascii(bytes, at, 4);
    // A mime item: its name, then its content type, each ending with a zero.
    const name = bytes.subarray(at + 4, infe.end).indexOf(0);
    const content = name < 0 ? '' : ascii(bytes, at + 5 + name, infe.end - (at + 5 + name));
    const xmp = type === 'mime' && content.startsWith('application/rdf+xml');
    types.set(id, xmp ? 'xmp' : type);
  }
  return types;
}

/**
 * Where each item's data is, from the meta box's iloc: its parts' starts and ends in the file.
 * Only items in the file itself or in the meta box's idat; throws RangeError when iloc doesn't
 * read.
 */
function itemParts(bytes: Uint8Array, iloc: Box, idat?: Box): Map<number, [number, number][]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
    if (!read || at + size > iloc.end) throw new RangeError('iloc');
    at += size;
    return read(at - size);
  };
  const sizes = take(2);
  const indexSize = version === 0 ? 0 : sizes & 15;
  const parts = new Map<number, [number, number][]>();
  for (let items = take(version < 2 ? 2 : 4); items > 0; items -= 1) {
    const id = take(version < 2 ? 2 : 4);
    const method = version === 0 ? 0 : take(2) & 15;
    const here = take(2) === 0;
    const base = take((sizes >> 4) & 15);
    const extents: [number, number][] = [];
    for (let count = take(2); count > 0; count -= 1) {
      take(indexSize);
      extents.push([base + take(sizes >> 12), take((sizes >> 8) & 15)]);
    }
    const within = method === 0 ? { start: 0, end: bytes.length } : method === 1 ? idat : undefined;
    if (!here || !within) continue;
    // A length of 0 runs to the end.
    const ranges = extents.map(([offset, length]): [number, number] => {
      const start = within.start + offset;
      return [start, length === 0 ? within.end : Math.min(start + length, within.end)];
    });
    parts.set(
      id,
      ranges.filter(([start, end]) => start < end),
    );
  }
  return parts;
}

function heif(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  const meta = boxesOf(copy, 0, copy.length).find((box) => box.type === 'meta');
  const inner = meta ? boxesOf(copy, meta.start + 4, meta.end) : [];
  const find = (type: string) => inner.find((box) => box.type === type);
  const iinf = find('iinf');
  const iloc = find('iloc');
  if (!iinf || !iloc) return copy;
  let parts: Map<number, [number, number][]>;
  try {
    parts = itemParts(copy, iloc, find('idat'));
  } catch (error) {
    if (error instanceof RangeError) return copy;
    throw error;
  }
  for (const [id, type] of itemTypes(copy, iinf)) {
    const ranges = parts.get(id) ?? [];
    if (type === 'xmp') for (const [start, end] of ranges) copy.fill(0x20, start, end);
    if (type !== 'Exif') continue;
    // Four bytes saying where the TIFF data starts, after them.
    const [only] = ranges;
    const single = only && ranges.length === 1 && only[1] - only[0] >= 4 ? only : null;
    const tiff = single ? single[0] + 4 + view.getUint32(single[0]) : 0;
    if (!single || !wipeGps(copy, tiff, single[1])) {
      for (const [start, end] of ranges) copy.fill(0, start, end);
    }
  }
  return copy;
}

/**
 * The file without its location data, when it's a JPEG, PNG, WebP, TIFF, HEIC or AVIF picture;
 * else as is.
 */
export function withoutLocation(bytes: Uint8Array): Uint8Array {
  const start = ascii(bytes, 0, 12);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return jpeg(bytes);
  if (start.startsWith('\x89PNG\r\n\x1a\n')) return png(bytes);
  if (start.startsWith('RIFF') && start.endsWith('WEBP')) return webp(bytes);
  if (start.startsWith('II*\0') || start.startsWith('MM\0*')) {
    const copy = bytes.slice();
    wipeGps(copy, 0, copy.length);
    return copy;
  }
  if (isHeif(bytes)) return heif(bytes);
  return bytes;
}
