import {
  pieceList,
  PictureError,
  windowedReader,
  type CleanerResult,
  type PictureFile,
  type WindowedReader,
} from './bytes';
import { exifOrientation, orientationExif, turnsSideways } from './exif';

// A JPEG is a list of segments (a 0xFF marker, then a length), then the image data, which ends at
// the next marker that isn't a restart. Location, camera and editing details live in APP segments
// and comments; phones also append more pictures (with their own details) after the end marker.

const SOS = 0xda;
const EOI = 0xd9;
const COMMENT = 0xfe;
const EXIF = 'Exif\0\0';

const isApp = (marker: number) => marker >= 0xe0 && marker <= 0xef;
/** Start-of-frame markers, which hold the size (not DHT, JPG and DAC, which share the range). */
const isFrame = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
/** Markers that stand alone, without a length: restarts and TEM. */
const standsAlone = (marker: number) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

/** APP segments that drawing the picture needs: JFIF, the colour profile and Adobe's colour flags. */
function isNeeded(marker: number, id: string): boolean {
  if (marker === 0xe0) return id.startsWith('JFIF\0');
  if (marker === 0xe2) return id.startsWith('ICC_PROFILE\0');
  return marker === 0xee && id.startsWith('Adobe');
}

/** An APP1 segment with Exif data that holds only the orientation. */
function orientationSegment(orientation: number): Buffer {
  const tiff = orientationExif(orientation);
  const header = Buffer.alloc(4 + EXIF.length);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(2 + EXIF.length + tiff.length, 2);
  header.write(EXIF, 4, 'latin1');
  return Buffer.concat([header, tiff]);
}

/** Keeps the image data, the tables and what colours need; drops the rest, keeping the orientation. */
export async function cleanJpeg(file: PictureFile): Promise<CleanerResult> {
  const reader = windowedReader(file);
  const { size, byte } = reader;
  const out = pieceList(size);
  out.keep(0, 2);
  let at = 2;
  let orientation = 0;
  let width = 0;
  let height = 0;
  while (at + 2 <= size) {
    if ((await byte(at)) !== 0xff) {
      at = await nextMarker(reader, at); // stray bytes between segments are left out
      continue;
    }
    let marker = await byte(at + 1);
    while (marker === 0xff && at + 2 < size) {
      at += 1; // fill bytes before a marker
      marker = await byte(at + 1);
    }
    if (marker === EOI) {
      out.keep(at, at + 2); // anything after the end is left out
      break;
    }
    if (standsAlone(marker)) {
      out.keep(at, at + 2);
      at += 2;
      continue;
    }
    if (at + 4 > size) break;
    const length = (await reader.bytes(at + 2, 2)).readUInt16BE(0);
    const end = at + 2 + length;
    if (length < 2 || end > size) throw new PictureError();
    if (isApp(marker) || marker === COMMENT) {
      const id = (await reader.bytes(at + 4, Math.min(length - 2, 12))).toString('latin1');
      if (marker === 0xe1 && id.startsWith(EXIF) && orientation === 0) {
        orientation = exifOrientation(await reader.bytes(at + 10, length - 8));
        const original = await reader.bytes(at, end - at);
        if (orientation !== 1) out.replace(at, end, original, orientationSegment(orientation));
      } else if (isNeeded(marker, id)) {
        out.keep(at, end);
      }
    } else {
      if (isFrame(marker) && length >= 7) {
        const frame = await reader.bytes(at + 5, 4);
        height = frame.readUInt16BE(0);
        width = frame.readUInt16BE(2);
      }
      out.keep(at, end);
    }
    at = end;
    if (marker === SOS) {
      const data = await nextMarker(reader, at);
      out.keep(at, data);
      at = data;
    }
  }
  return { width, height, sideways: turnsSideways(orientation), pieces: out.done() };
}

/** Where the next marker starts (image data escapes 0xFF as 0xFF 0x00), or the file's size. */
async function nextMarker(reader: WindowedReader, from: number): Promise<number> {
  const chunk = 64 * 1024;
  let at = from;
  while (at < reader.size) {
    const bytes = await reader.bytes(at, Math.min(chunk, reader.size - at));
    const found = bytes.indexOf(0xff);
    if (found === -1) {
      at += bytes.length;
      continue;
    }
    const mark = at + found;
    if (mark + 1 >= reader.size) return reader.size;
    const next = await reader.byte(mark + 1);
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) at = mark + 2;
    else return mark;
  }
  return reader.size;
}
