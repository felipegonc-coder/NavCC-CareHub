// Fictional sample pictures for the tests: the real structure of each format, with made-up details
// that must go. The image data is filler: the cleaners never decode pixels.

import { orientationExif } from './exif';
import { pngChunk } from './png';

/** Appears in every detail that must be removed. */
export const DETAIL = 'Fictional Harbour Road';

const u16 = (value: number) => Buffer.from([value >> 8, value & 0xff]);
const u32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};
const text = (value: string) => Buffer.from(value, 'latin1');

/** Exif data with an orientation, a camera name and a GPS folder. */
export function sampleExif(orientation: number): Buffer {
  const name = text(`${DETAIL}\0`);
  const makeAt = 8 + 2 + 3 * 12 + 4;
  const gpsAt = makeAt + name.length;
  const datumAt = gpsAt + 2 + 12 + 4;
  const entry = (tag: number, type: number, count: number, value: number) =>
    Buffer.concat([
      u16(tag),
      u16(type),
      u32(count),
      type === 3 ? Buffer.concat([u16(value), u16(0)]) : u32(value),
    ]);
  return Buffer.concat([
    text('MM'),
    u16(42),
    u32(8),
    u16(3),
    entry(0x010f, 2, name.length, makeAt),
    entry(0x0112, 3, 1, orientation),
    entry(0x8825, 4, 1, gpsAt),
    u32(0),
    name,
    u16(1),
    entry(0x0012, 2, name.length, datumAt),
    u32(0),
    name,
  ]);
}

const segment = (marker: number, payload: Buffer) =>
  Buffer.concat([u16(0xff00 | marker), u16(payload.length + 2), payload]);

/** A JPEG with Exif (orientation 6), XMP, IPTC and a comment, and a second picture after its end. */
export function sampleJpeg() {
  const start = u16(0xffd8);
  const end = u16(0xffd9);
  const exif = (orientation: number) =>
    segment(0xe1, Buffer.concat([text('Exif\0\0'), sampleExif(orientation)]));
  const jfif = segment(0xe0, text('JFIF\0\x01\x02\0\0\x01\0\x01\0\0'));
  const colours = segment(0xe2, text('ICC_PROFILE\0\x01\x01fictional colours'));
  const tables = segment(0xdb, Buffer.alloc(65, 1));
  const frame = segment(
    0xc0,
    Buffer.concat([Buffer.from([8]), u16(48), u16(64), Buffer.from([1, 1, 0x11, 0])]),
  );
  // Image data escapes 0xFF as 0xFF 0x00 and has restart markers.
  const scan = Buffer.concat([
    segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.from([0x12, 0xff, 0, 0x34, 0xff, 0xd0, 0x56]),
  ]);
  const file = Buffer.concat([
    start,
    jfif,
    exif(6),
    segment(0xe1, text(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>${DETAIL}</x:xmpmeta>`)),
    colours,
    segment(0xed, text(`Photoshop 3.0\0${DETAIL}`)),
    segment(0xfe, text(DETAIL)),
    tables,
    frame,
    scan,
    end,
    start,
    exif(1),
    end,
  ]);
  const orientationOnly = segment(0xe1, Buffer.concat([text('Exif\0\0'), orientationExif(6)]));
  const cleaned = Buffer.concat([start, jfif, orientationOnly, colours, tables, frame, scan, end]);
  return { file, cleaned, width: 48, height: 64, orientation: 6 };
}

/** A PNG with text, Exif (orientation 6) and a time, and bytes after its end. */
export function samplePng() {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  const header = pngChunk('IHDR', Buffer.concat([u32(64), u32(48), Buffer.from([8, 2, 0, 0, 0])]));
  const colours = pngChunk('iCCP', text('fictional\0\0colours'));
  const image = pngChunk('IDAT', Buffer.from('789c636000000002000100', 'hex'));
  const last = pngChunk('IEND', Buffer.alloc(0));
  const file = Buffer.concat([
    signature,
    header,
    pngChunk('tEXt', text(`Location\0${DETAIL}`)),
    pngChunk('eXIf', sampleExif(6)),
    colours,
    pngChunk('iTXt', text(`XML:com.adobe.xmp\0\0\0\0\0${DETAIL}`)),
    pngChunk('tIME', Buffer.from([7, 234, 10, 27, 9, 30, 0])),
    image,
    last,
    text(DETAIL),
  ]);
  const cleaned = Buffer.concat([
    signature,
    header,
    pngChunk('eXIf', orientationExif(6)),
    colours,
    image,
    last,
  ]);
  return { file, cleaned, width: 48, height: 64, orientation: 6 };
}
