import { decodeCsvBytes } from '@carehub/databases/csv';
import {
  crc32,
  readZip,
  readZipEntry,
  type ZipArchive,
  type ZipEntry,
  type ZipEntryRead,
  type ZipProblem,
} from '@carehub/databases/xlsx';
import { ImportFileError, type ImportZip } from '@carehub/extras/import-export/import/index';

// Zips in the browser, for the sources the Import screen reads itself (docs/extras/import-export.md):
// the zip the person picked, read with #109's reader and its limits the way the server reads one,
// and the upload, plan.json and its files.

/** Why a zip can't be read, in the server's words (its import reads zips the same way). */
const ZIP_REASONS: Record<ZipProblem, string> = {
  not_zip: "the file isn't a zip",
  damaged: 'the zip is damaged',
  unsupported: "the zip is packed in a way Care Hub can't open",
  encrypted: 'the zip has a password',
  too_many_entries: 'zips can have up to 1,000 files',
  entry_too_big: 'a file inside is over 50 MB',
  too_big: 'the zip unpacks to more than 100 MB',
};

/** Entries over 1 MB may unpack to at most 200 times their packed size (zip bomb safety). */
const RATIO = { from: 1024 * 1024, max: 200 };

/** Inflates raw DEFLATE data (no zlib header), failing rather than giving more than `max` bytes. */
export type Inflate = (bytes: Uint8Array, max: number) => Promise<Uint8Array>;

function joined(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** The browser's DecompressionStream, stopped as soon as it gives more than `max` bytes. */
export const inflateRaw: Inflate = async (bytes, max) => {
  const packed = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes as Uint8Array<ArrayBuffer>);
      controller.close();
    },
  });
  const reader = packed.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error('Bigger than its zip says.');
    }
    chunks.push(read.value);
  }
  return joined(chunks, size);
};

/**
 * One entry's bytes. readZipEntry checks the entry's header, size and CRC-32, but inflates
 * synchronously, so the first pass only finds the packed bytes and the second checks what the
 * browser inflated.
 */
async function entryBytes(zip: ZipArchive, entry: ZipEntry, inflate: Inflate) {
  const packed: { bytes?: Uint8Array } = {};
  let read: ZipEntryRead = readZipEntry(zip, entry, (bytes) => {
    packed.bytes = bytes;
    throw new Error('Inflated next.');
  });
  if (packed.bytes) {
    const data = await inflate(packed.bytes, entry.size).catch(() => null);
    read = data ? readZipEntry(zip, entry, () => data) : { ok: false, problem: 'damaged' };
  }
  if (!read.ok) throw new ImportFileError(ZIP_REASONS[read.problem]);
  return read.bytes;
}

/** A zip the person picked, as importers read it. Names are only compared, never used as paths. */
export function openZip(bytes: Uint8Array, inflate: Inflate = inflateRaw): ImportZip {
  const read = readZip(bytes);
  if (!read.ok) throw new ImportFileError(ZIP_REASONS[read.problem]);
  const entries = new Map<string, ZipEntry>();
  for (const entry of read.zip.entries) {
    if (entry.size > RATIO.from && entry.size > entry.compressedSize * RATIO.max) {
      throw new ImportFileError('the zip is packed too tightly to open safely');
    }
    if (!entry.name.endsWith('/') && !entries.has(entry.name)) entries.set(entry.name, entry);
  }
  const bytesOf = async (name: string) => {
    const entry = entries.get(name);
    if (!entry) throw new ImportFileError('the zip is damaged');
    return entryBytes(read.zip, entry, inflate);
  };
  return {
    names: [...entries.keys()],
    read: bytesOf,
    text: async (name) => decodeCsvBytes(await bytesOf(name)),
  };
}

export interface ZipItem {
  name: string;
  bytes: Uint8Array;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
/** Bit 11: names are UTF-8. */
const UTF8_NAMES = 0x0800;
/** 1 January 1980, the first day a zip can say. */
const DOS_DATE = 0x21;

/** A zip header: `size` bytes, with each [offset, bits, value] written in. */
function header(size: number, fields: readonly [number, 16 | 32, number][], name: Uint8Array) {
  const bytes = new Uint8Array(size + name.byteLength);
  const view = new DataView(bytes.buffer);
  for (const [offset, bits, value] of fields) {
    if (bits === 16) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
  }
  bytes.set(name, size);
  return bytes;
}

/**
 * A zip of these items, stored rather than packed (pictures are packed already), as the parts of
 * a Blob. The server reads it with the same reader and limits as any zip.
 */
export function zipParts(items: readonly ZipItem[]): Uint8Array[] {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const item of items) {
    const name = new TextEncoder().encode(item.name);
    const size = item.bytes.byteLength;
    const crc = crc32(item.bytes);
    const local = header(
      30,
      [
        [0, 32, LOCAL],
        [4, 16, 20],
        [6, 16, UTF8_NAMES],
        [12, 16, DOS_DATE],
        [14, 32, crc],
        [18, 32, size],
        [22, 32, size],
        [26, 16, name.byteLength],
      ],
      name,
    );
    central.push(
      header(
        46,
        [
          [0, 32, CENTRAL],
          [4, 16, 20],
          [6, 16, 20],
          [8, 16, UTF8_NAMES],
          [14, 16, DOS_DATE],
          [16, 32, crc],
          [20, 32, size],
          [24, 32, size],
          [28, 16, name.byteLength],
          [42, 32, offset],
        ],
        name,
      ),
    );
    parts.push(local, item.bytes);
    offset += local.byteLength + size;
  }
  const directorySize = central.reduce((sum, part) => sum + part.byteLength, 0);
  const end = header(
    22,
    [
      [0, 32, END],
      [8, 16, items.length],
      [10, 16, items.length],
      [12, 32, directorySize],
      [16, 32, offset],
    ],
    new Uint8Array(0),
  );
  return [...parts, ...central, end];
}
