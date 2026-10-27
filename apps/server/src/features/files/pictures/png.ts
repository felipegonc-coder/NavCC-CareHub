import {
  pieceList,
  PictureError,
  windowedReader,
  type CleanerResult,
  type PictureFile,
} from './bytes';
import { exifOrientation, orientationExif, turnsSideways } from './exif';

// A PNG is a signature, then chunks: length, type, data and a CRC. Text, Exif, times and other
// extra chunks can hold location and camera details; drawing needs only the ones kept here.

const SIGNATURE = 8;
/** Extra chunks that change how the picture looks, or animate it. */
const DRAWING = new Set([
  ...['tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'hIST', 'sPLT'],
  ...['acTL', 'fcTL', 'fdAT', 'cICP', 'mDCv', 'cLLI'],
]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A PNG chunk: length, type, data, CRC. */
export function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'latin1');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

/** Keeps the image and drawing chunks; drops the rest, keeping the orientation. */
export async function cleanPng(file: PictureFile): Promise<CleanerResult> {
  const reader = windowedReader(file);
  const out = pieceList(file.size);
  out.keep(0, SIGNATURE);
  let at = SIGNATURE;
  let width = 0;
  let height = 0;
  let orientation = 0;
  while (at + 12 <= file.size) {
    const header = await reader.bytes(at, 8);
    const length = header.readUInt32BE(0);
    const type = header.toString('latin1', 4, 8);
    const end = at + 12 + length;
    if (length > 0x7fffffff || end > file.size) throw new PictureError();
    if (type === 'IHDR' && length >= 8) {
      const data = await reader.bytes(at + 8, 8);
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    const critical = ((header[4] ?? 0) & 0x20) === 0; // an upper-case first letter
    if (type === 'eXIf' && orientation === 0) {
      orientation = exifOrientation(await reader.bytes(at + 8, length));
      const original = await reader.bytes(at, end - at);
      if (orientation !== 1)
        out.replace(at, end, original, pngChunk('eXIf', orientationExif(orientation)));
    } else if (critical || DRAWING.has(type)) {
      out.keep(at, end);
    }
    at = end;
    if (type === 'IEND') break; // anything after the end is left out
  }
  return { width, height, sideways: turnsSideways(orientation), pieces: out.done() };
}
