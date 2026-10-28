// Photos' location data (Import and export spec, section 3.1; IE-09): imported pictures keep how
// they look, but not where they were taken. In JPEG and TIFF files the EXIF GPS fields are wiped,
// so the rest of EXIF (such as which way up the photo is) stays. XMP, which can hold the place
// too, is left out of JPEG, PNG and WebP files, as are JPEG's Photoshop and IPTC data and PNG's
// and WebP's EXIF. A JPEG's EXIF that can't be read safely is left out whole.

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

/** The file without its location data, when it's a JPEG, PNG, WebP or TIFF picture; else as is. */
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
  return bytes;
}
