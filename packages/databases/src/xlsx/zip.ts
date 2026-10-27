/**
 * Reading .zip files, the container of .xlsx workbooks: the central directory and its entries,
 * stored or deflated. Inflating is passed in (the server uses node:zlib), so the package needs no
 * Node APIs. Encryption, the entry count and the unpacked sizes are checked before anything is
 * inflated (zip bomb safety), and every entry's CRC-32 is checked after.
 */
import { decodeCsvBytes } from '../csv/decode';

/**
 * Inflates raw DEFLATE data (no zlib header). It must throw rather than give more than
 * `maxOutputBytes`; the server passes `(b, max) => inflateRawSync(b, { maxOutputLength: max })`.
 */
export type InflateRaw = (bytes: Uint8Array, maxOutputBytes: number) => Uint8Array;

/** At most 1,000 entries, 50 MB per entry once unpacked and 100 MB in all. */
export const ZIP_LIMITS = {
  entries: 1_000,
  entryBytes: 50 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
} as const;

/** Why a zip can't be read; the import turns each into a message. */
export type ZipProblem =
  | 'not_zip'
  | 'damaged'
  /** ZIP64, split archives or a compression other than stored and deflate. */
  | 'unsupported'
  | 'encrypted'
  | 'too_many_entries'
  | 'entry_too_big'
  | 'too_big';

export interface ZipEntry {
  /** Path inside the zip, with "/" between folders. */
  name: string;
  /** 0 stored, 8 deflated. */
  method: number;
  crc32: number;
  compressedSize: number;
  /** Size once unpacked, as the central directory says. */
  size: number;
  /** Where the entry's local header starts. */
  headerOffset: number;
}

/** A zip whose central directory passed the checks. */
export interface ZipArchive {
  bytes: Uint8Array;
  /** In central directory order. */
  entries: ZipEntry[];
}

export type ZipRead = { ok: true; zip: ZipArchive } | { ok: false; problem: ZipProblem };
export type ZipEntryRead = { ok: true; bytes: Uint8Array } | { ok: false; problem: ZipProblem };

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;
/** Flag bits 0 (encrypted) and 6 (strong encryption); method 99 is AES. */
const ENCRYPTED_FLAGS = 0x41;
const AES = 99;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 checksum zip uses ("123456789" gives 0xCBF43926). */
export function crc32(bytes: Uint8Array): number {
  let c = MAX_U32;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ MAX_U32) >>> 0;
}

const viewOf = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Where the end of central directory record starts (it's followed exactly by its comment), or -1. */
function findEnd(view: DataView): number {
  const last = view.byteLength - 22;
  for (let i = last; i >= 0 && i >= last - MAX_U16; i--) {
    if (
      view.getUint32(i, true) === END &&
      i + 22 + view.getUint16(i + 20, true) === view.byteLength
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Reads the central directory. Refuses, before inflating anything: encrypted entries, more than
 * 1,000 entries, an entry over 50 MB or a total over 100 MB once unpacked (as declared; reading an
 * entry checks it really is that size).
 */
export function readZip(bytes: Uint8Array): ZipRead {
  const fail = (problem: ZipProblem): ZipRead => ({ ok: false, problem });
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return fail('not_zip');
  const view = viewOf(bytes);
  const end = findEnd(view);
  if (end < 0) return fail('damaged');
  const count = view.getUint16(end + 10, true);
  const cdSize = view.getUint32(end + 12, true);
  const cdOffset = view.getUint32(end + 16, true);
  if (count === MAX_U16 || cdSize === MAX_U32 || cdOffset === MAX_U32) return fail('unsupported');
  const disk = view.getUint16(end + 4, true) | view.getUint16(end + 6, true);
  if (disk !== 0 || view.getUint16(end + 8, true) !== count) return fail('unsupported');
  if (count > ZIP_LIMITS.entries) return fail('too_many_entries');
  if (cdOffset + cdSize > end) return fail('damaged');
  const entries: ZipEntry[] = [];
  let total = 0;
  let p = cdOffset;
  for (let k = 0; k < count; k++) {
    if (p + 46 > end || view.getUint32(p, true) !== CENTRAL) return fail('damaged');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const next = p + 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
    const headerOffset = view.getUint32(p + 42, true);
    if (next > end) return fail('damaged');
    if (flags & ENCRYPTED_FLAGS || method === AES) return fail('encrypted');
    if (size === MAX_U32 || compressedSize === MAX_U32 || headerOffset === MAX_U32) {
      return fail('unsupported');
    }
    if (size > ZIP_LIMITS.entryBytes) return fail('entry_too_big');
    total += size;
    if (total > ZIP_LIMITS.totalBytes) return fail('too_big');
    const name = decodeCsvBytes(bytes.subarray(p + 46, p + 46 + nameLength)).replace(/\\/g, '/');
    entries.push({
      name,
      method,
      crc32: view.getUint32(p + 16, true),
      compressedSize,
      size,
      headerOffset,
    });
    p = next;
  }
  return { ok: true, zip: { bytes, entries } };
}

/**
 * One entry's bytes. Deflated entries are inflated with at most their declared size as the limit;
 * the result must be exactly that size and match the CRC-32, otherwise the zip counts as damaged.
 */
export function readZipEntry(
  zip: ZipArchive,
  entry: ZipEntry,
  inflateRaw: InflateRaw,
): ZipEntryRead {
  const fail = (problem: ZipProblem): ZipEntryRead => ({ ok: false, problem });
  const { bytes } = zip;
  const view = viewOf(bytes);
  const h = entry.headerOffset;
  if (h + 30 > bytes.length || view.getUint32(h, true) !== LOCAL) return fail('damaged');
  const start = h + 30 + view.getUint16(h + 26, true) + view.getUint16(h + 28, true);
  if (start + entry.compressedSize > bytes.length) return fail('damaged');
  const raw = bytes.subarray(start, start + entry.compressedSize);
  let data: Uint8Array;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) return fail('damaged');
    data = raw;
  } else if (entry.method === 8) {
    if (entry.size === 0) {
      data = new Uint8Array(0);
    } else {
      try {
        data = inflateRaw(raw, entry.size);
      } catch {
        return fail('damaged');
      }
      if (data.length !== entry.size) return fail('damaged');
    }
  } else {
    return fail('unsupported');
  }
  return crc32(data) === entry.crc32 ? { ok: true, bytes: data } : fail('damaged');
}
