import { deflateRawSync, deflateSync, inflateRawSync } from 'node:zlib';

// The files these tests import are made here at run time, so every one is fictional and written
// from scratch: zips (local headers, central directory and end record, as in PKWARE's APPNOTE)
// and small PNG pictures. unzip() reads an export back.

/** A file for a file picker, as Playwright's setFiles takes it. */
export type FilePayload = { name: string; mimeType: string; buffer: Buffer };

/** One file inside a zip: its path with "/" between folders, and its bytes or UTF-8 text. */
export type ZipEntry = { path: string; data: Buffer | string };

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Oct 27, 2026 as a zip (MS-DOS) date; the time is midnight. */
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 27;

/** A zip of `entries`, deflated, with UTF-8 names. */
export function zip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const data = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const packed = deflateRawSync(data);
    // The fields both headers share: version, UTF-8 flag, deflate, time, date, CRC and sizes.
    const shared = Buffer.alloc(26);
    shared.writeUInt16LE(20, 0);
    shared.writeUInt16LE(0x0800, 2);
    shared.writeUInt16LE(8, 4);
    shared.writeUInt16LE(DOS_DATE, 8);
    shared.writeUInt32LE(crc32(data), 10);
    shared.writeUInt32LE(packed.length, 14);
    shared.writeUInt32LE(data.length, 18);
    shared.writeUInt16LE(name.length, 22);
    const local = Buffer.concat([u32(0x04034b50), shared]);
    const tail = Buffer.alloc(14);
    tail.writeUInt32LE(offset, 10);
    directory.push(u32(0x02014b50), u16(20), shared, tail, name);
    parts.push(local, name, packed);
    offset += local.length + name.length + packed.length;
  }
  const listing = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(listing.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, listing, end]);
}

/** The files in a zip by path (folders left out), unpacked. */
export function unzip(file: Buffer): Map<string, Buffer> {
  const end = file.lastIndexOf(u32(0x06054b50));
  if (end < 0) throw new Error('The download is not a zip.');
  const files = new Map<string, Buffer>();
  let at = file.readUInt32LE(end + 16);
  for (let left = file.readUInt16LE(end + 10); left > 0; left -= 1) {
    const method = file.readUInt16LE(at + 10);
    const size = file.readUInt32LE(at + 20);
    const nameEnd = at + 46 + file.readUInt16LE(at + 28);
    const name = file.subarray(at + 46, nameEnd).toString('utf8');
    const local = file.readUInt32LE(at + 42);
    const start = local + 30 + file.readUInt16LE(local + 26) + file.readUInt16LE(local + 28);
    const packed = file.subarray(start, start + size);
    if (!name.endsWith('/')) files.set(name, method === 8 ? inflateRawSync(packed) : packed);
    at = nameEnd + file.readUInt16LE(at + 30) + file.readUInt16LE(at + 32);
  }
  return files;
}

/** A PNG picture of one colour, `width` × `height` pixels. */
export function png(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    return Buffer.concat([u32(data.length, 'BE'), body, u32(crc32(body), 'BE')]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(2, 9);
  const line = Buffer.concat([Buffer.from([0]), ...Array(width).fill(Buffer.from([r, g, b]))]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(line)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** True when `data` starts like a PNG file. */
export const isPng = (data: Buffer | undefined) =>
  data?.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ?? false;

function u32(value: number, order: 'LE' | 'BE' = 'LE'): Buffer {
  const bytes = Buffer.alloc(4);
  if (order === 'LE') bytes.writeUInt32LE(value >>> 0);
  else bytes.writeUInt32BE(value >>> 0);
  return bytes;
}

function u16(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}
