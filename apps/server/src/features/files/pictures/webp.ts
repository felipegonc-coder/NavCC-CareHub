import {
  piecesLength,
  PictureError,
  pieceList,
  windowedReader,
  type CleanerResult,
  type PictureFile,
} from './bytes';
import { exifOrientation, orientationExif, turnsSideways } from './exif';

// A WebP is a RIFF file: "RIFF", the size, "WEBP", then chunks (type, size, data, padded to even).
// Exif and XMP chunks hold the details; the VP8X chunk's flags say which chunks are there.

const KEPT = new Set(['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
const EXIF_FLAG = 0x08;
const XMP_FLAG = 0x04;

function riffChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(8 + data.length + (data.length % 2));
  chunk.write(type, 0, 'latin1');
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  return chunk;
}

const u24 = (bytes: Buffer, at: number) => bytes.readUIntLE(at, 3);

/** The canvas size from the first image chunk. */
function sizeOf(type: string, data: Buffer): [number, number] | null {
  if (type === 'VP8X' && data.length >= 10) return [u24(data, 4) + 1, u24(data, 7) + 1];
  if (type === 'VP8L' && data.length >= 5 && data[0] === 0x2f) {
    const bits = data.readUInt32LE(1);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  if (type === 'VP8 ' && data.length >= 10 && data.readUIntBE(3, 3) === 0x9d012a) {
    return [data.readUInt16LE(6) & 0x3fff, data.readUInt16LE(8) & 0x3fff];
  }
  return null;
}

/** Keeps the image, animation and colour-profile chunks; drops the rest, keeping the orientation. */
export async function cleanWebp(file: PictureFile): Promise<CleanerResult> {
  const reader = windowedReader(file);
  const riff = await reader.bytes(0, 12);
  const riffEnd = 8 + riff.readUInt32LE(4);
  if (riffEnd > file.size) throw new PictureError();
  let shown: [number, number] | null = null;
  let orientation = 0;
  let flags: { at: number; data: Buffer } | null = null;
  const chunks: { type: string; start: number; end: number }[] = [];
  for (let at = 12; at + 8 <= riffEnd;) {
    const header = await reader.bytes(at, 8);
    const type = header.toString('latin1', 0, 4);
    const length = header.readUInt32LE(4);
    if (at + 8 + length > riffEnd) throw new PictureError();
    if (!shown && (type === 'VP8X' || type === 'VP8L' || type === 'VP8 ')) {
      const data = Buffer.from(await reader.bytes(at + 8, Math.min(length, 10)));
      shown = sizeOf(type, data);
      if (type === 'VP8X' && length >= 10) flags = { at, data };
    }
    if (type === 'EXIF' && orientation === 0) {
      const exif = await reader.bytes(at + 8, length);
      const tiff = exif.toString('latin1', 0, 6) === 'Exif\0\0' ? exif.subarray(6) : exif;
      orientation = exifOrientation(tiff);
    }
    const end = Math.min(at + 8 + length + (length % 2), riffEnd);
    chunks.push({ type, start: at, end });
    at = end;
  }
  // Only the extended format (VP8X) may carry Exif.
  const keepsOrientation = orientation > 1 && flags !== null;
  const out = pieceList(file.size);
  out.keep(0, 12);
  let exifDone = false;
  for (const chunk of chunks) {
    if (chunk.start === flags?.at) {
      const data = Buffer.from(flags.data);
      data[0] = ((data[0] ?? 0) & ~(XMP_FLAG | EXIF_FLAG)) | (keepsOrientation ? EXIF_FLAG : 0);
      if (data[0] === flags.data[0]) out.keep(chunk.start, chunk.end);
      else out.add(riffChunk('VP8X', data));
    } else if (chunk.type === 'EXIF') {
      if (keepsOrientation && !exifDone) {
        const original = await reader.bytes(chunk.start, chunk.end - chunk.start);
        out.replace(
          chunk.start,
          chunk.end,
          original,
          riffChunk('EXIF', orientationExif(orientation)),
        );
      }
      exifDone = true;
    } else if (KEPT.has(chunk.type)) {
      out.keep(chunk.start, chunk.end);
    }
  }
  const pieces = out.done();
  if (pieces?.[0] && !Buffer.isBuffer(pieces[0])) {
    // The RIFF size counts everything after its first 8 bytes.
    const header = Buffer.from(riff);
    header.writeUInt32LE(piecesLength(pieces) - 8, 4);
    const { end } = pieces[0];
    pieces.splice(0, 1, header, ...(end > 12 ? [{ start: 12, end }] : []));
  }
  const [width = 0, height = 0] = shown ?? [];
  return { width, height, sideways: keepsOrientation && turnsSideways(orientation), pieces };
}
