// The zip an export downloads as (Import and export spec, section 3.3), written with node:zlib
// only. Entries are deflated unless that doesn't make them smaller, names are UTF-8, and the
// total is capped: ZIP64 isn't written, so neither 65,535 entries nor 4 GB is ever reached.
import { promisify } from 'node:util';
import { crc32, deflateRaw } from 'node:zlib';

const deflate = promisify(deflateRaw);
const MAX_ENTRIES = 65_535;
const MAX_ZIP_BYTES = 0xffff_ffff;
/** UTF-8 names (general purpose bit 11). */
const UTF8 = 0x0800;
/** A regular file, rw-r--r--, in the upper half of the external attributes. */
const FILE_MODE = (0o100644 << 16) >>> 0;

export class ExportTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`The export would be over ${limitBytes} bytes.`);
    this.name = 'ExportTooLargeError';
  }
}

interface Entry {
  name: Buffer;
  crc: number;
  method: 0 | 8;
  size: number;
  compressedSize: number;
  offset: number;
}

/** Paths the exporter made itself: relative, `/`-separated, with no empty, `.` or `..` parts. */
function isSafePath(path: string): boolean {
  if (path.length === 0 || path.length > 1_000 || path.includes('\\')) return false;
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** MS-DOS time and date, as zip headers keep them. */
function dosStamp(at: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, at.getFullYear()));
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

export interface ZipWriterOptions {
  /** The most file content (before compression) the zip may hold. */
  maxBytes: number;
  now?: Date;
}

export class ZipWriter {
  readonly #chunks: Buffer[] = [];
  readonly #entries: Entry[] = [];
  readonly #names = new Set<string>();
  readonly #stamp: { time: number; date: number };
  readonly #maxBytes: number;
  #offset = 0;
  #contentBytes = 0;

  constructor(options: ZipWriterOptions) {
    this.#maxBytes = options.maxBytes;
    this.#stamp = dosStamp(options.now ?? new Date());
  }

  /** File content added so far, before compression. */
  get contentBytes(): number {
    return this.#contentBytes;
  }

  /** Adds a file. `compress: false` for content that's already compressed, like pictures. */
  async add(path: string, data: Buffer | string, options: { compress?: boolean } = {}) {
    if (!isSafePath(path))
      throw new TypeError('Zip paths are relative names made by the exporter.');
    const key = path.toLowerCase();
    if (this.#names.has(key)) throw new TypeError('Zip paths are unique.');
    const raw = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    this.#contentBytes += raw.length;
    if (this.#contentBytes > this.#maxBytes || this.#entries.length >= MAX_ENTRIES) {
      throw new ExportTooLargeError(this.#maxBytes);
    }
    this.#names.add(key);
    const deflated = options.compress === false || raw.length === 0 ? null : await deflate(raw);
    const stored = deflated === null || deflated.length >= raw.length;
    const body = stored ? raw : deflated;
    const entry: Entry = {
      name: Buffer.from(path, 'utf8'),
      crc: crc32(raw),
      method: stored ? 0 : 8,
      size: raw.length,
      compressedSize: body.length,
      offset: this.#offset,
    };
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(UTF8, 6);
    header.writeUInt16LE(entry.method, 8);
    header.writeUInt16LE(this.#stamp.time, 10);
    header.writeUInt16LE(this.#stamp.date, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(entry.compressedSize, 18);
    header.writeUInt32LE(entry.size, 22);
    header.writeUInt16LE(entry.name.length, 26);
    this.#push(header, entry.name, body);
    this.#entries.push(entry);
  }

  /** The finished zip: the files, then the central directory. */
  finish(): Buffer {
    const start = this.#offset;
    for (const entry of this.#entries) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      // Made by Unix (3), zip 2.0; needs 2.0.
      header.writeUInt16LE((3 << 8) | 20, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(UTF8, 8);
      header.writeUInt16LE(entry.method, 10);
      header.writeUInt16LE(this.#stamp.time, 12);
      header.writeUInt16LE(this.#stamp.date, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressedSize, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.name.length, 28);
      header.writeUInt32LE(FILE_MODE, 38);
      header.writeUInt32LE(entry.offset, 42);
      this.#push(header, entry.name);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.#entries.length, 8);
    end.writeUInt16LE(this.#entries.length, 10);
    end.writeUInt32LE(this.#offset - start, 12);
    end.writeUInt32LE(start, 16);
    this.#push(end);
    return Buffer.concat(this.#chunks);
  }

  #push(...parts: Buffer[]) {
    for (const part of parts) {
      this.#offset += part.length;
      if (this.#offset > MAX_ZIP_BYTES) throw new ExportTooLargeError(this.#maxBytes);
      this.#chunks.push(part);
    }
  }
}
