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
  return { file, cleaned, width: 48, height: 64 };
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
  return { file, cleaned, width: 48, height: 64 };
}

const riffChunk = (type: string, data: Buffer) => {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  return Buffer.concat([text(type), size, data, Buffer.alloc(data.length % 2)]);
};
const riff = (chunks: Buffer[]) => {
  const body = Buffer.concat([text('WEBP'), ...chunks]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([text('RIFF'), size, body]);
};

/** An extended WebP with Exif (orientation 6) and XMP. */
export function sampleWebp() {
  const extended = (flags: number) =>
    riffChunk('VP8X', Buffer.from([flags, 0, 0, 0, 63, 0, 0, 47, 0, 0])); // 64 × 48
  const colours = riffChunk('ICCP', text('fictional colours'));
  const image = riffChunk('VP8L', Buffer.from([0x2f, 0x3f, 0xc0, 0x0b, 0x00, 0x10, 0x07]));
  const file = riff([
    extended(0x2c),
    colours,
    image,
    riffChunk('EXIF', sampleExif(6)),
    riffChunk('XMP ', text(DETAIL)),
  ]);
  const cleaned = riff([extended(0x28), colours, image, riffChunk('EXIF', orientationExif(6))]);
  return { file, cleaned, width: 48, height: 64 };
}

const subBlocks = (data: Buffer) =>
  Buffer.concat([Buffer.from([data.length]), data, Buffer.from([0])]);

/** An animated GIF with a comment, XMP, and bytes after its end. */
export function sampleGif() {
  const screen = Buffer.concat([text('GIF89a'), Buffer.from([64, 0, 48, 0, 0, 0, 0])]);
  const looping = Buffer.concat([
    Buffer.from([0x21, 0xff]),
    subBlocks(text('NETSCAPE2.0')).subarray(0, 12),
    subBlocks(Buffer.from([1, 0, 0])),
  ]);
  const timing = Buffer.from([0x21, 0xf9, 4, 0, 10, 0, 0, 0]);
  const image = Buffer.concat([
    Buffer.from([0x2c, 0, 0, 0, 0, 64, 0, 48, 0, 0, 2]),
    subBlocks(Buffer.from([0x44, 0x01])),
  ]);
  const file = Buffer.concat([
    screen,
    looping,
    Buffer.concat([Buffer.from([0x21, 0xfe]), subBlocks(text(DETAIL))]),
    Buffer.concat([
      Buffer.from([0x21, 0xff]),
      subBlocks(text('XMP DataXMP')).subarray(0, 12),
      subBlocks(text(DETAIL)),
    ]),
    timing,
    image,
    Buffer.from([0x3b]),
    text(DETAIL),
  ]);
  const cleaned = Buffer.concat([screen, looping, timing, image, Buffer.from([0x3b])]);
  return { file, cleaned, width: 64, height: 48 };
}

const box = (type: string, ...contents: Buffer[]) => {
  const body = Buffer.concat(contents);
  return Buffer.concat([u32(8 + body.length), text(type), body]);
};
const fullBox = (type: string, version: number, flags: number, ...contents: Buffer[]) =>
  box(type, Buffer.from([version, flags >> 16, (flags >> 8) & 0xff, flags & 0xff]), ...contents);

/** A HEIC with Exif and XMP items, cropped ('clap') from 64 × 64 to 64 × 48 and turned a quarter. */
export function sampleHeic() {
  const image = Buffer.alloc(32, 0x55);
  const exif = Buffer.concat([u32(6), text('Exif\0\0'), sampleExif(1)]);
  const xmp = text(`<x:xmpmeta xmlns:x="adobe:ns:meta/">${DETAIL}</x:xmpmeta>`.padEnd(120, ' '));
  const infe = (id: number, type: string, contentType = '') =>
    fullBox(
      'infe',
      2,
      0,
      u16(id),
      u16(0),
      text(type),
      text('\0'),
      contentType ? text(`${contentType}\0`) : Buffer.alloc(0),
    );
  const meta = (dataAt: number) =>
    fullBox(
      'meta',
      0,
      0,
      fullBox('hdlr', 0, 0, u32(0), text('pict'), Buffer.alloc(12), text('\0')),
      fullBox('pitm', 0, 0, u16(1)),
      fullBox(
        'iinf',
        0,
        0,
        u16(3),
        infe(1, 'hvc1'),
        infe(2, 'Exif'),
        infe(3, 'mime', 'application/rdf+xml'),
      ),
      fullBox(
        'iloc',
        0,
        0,
        Buffer.from([0x44, 0x00]),
        u16(3),
        ...[
          [1, dataAt, image.length],
          [2, dataAt + image.length, exif.length],
          [3, dataAt + image.length + exif.length, xmp.length],
        ].map(([id = 0, offset = 0, length = 0]) =>
          Buffer.concat([u16(id), u16(0), u16(1), u32(offset), u32(length)]),
        ),
      ),
      box(
        'iprp',
        box(
          'ipco',
          fullBox('ispe', 0, 0, u32(64), u32(64)),
          box('clap', u32(64), u32(1), u32(48), u32(1), u32(0), u32(1), u32(0), u32(1)),
          box('irot', Buffer.from([1])),
        ),
        fullBox('ipma', 0, 0, u32(1), u16(1), Buffer.from([3, 0x81, 0x82, 0x83])),
      ),
    );
  const type = box('ftyp', text('heic'), u32(0), text('mif1heic'));
  const dataAt = type.length + meta(0).length + 8;
  const head = Buffer.concat([type, meta(dataAt)]);
  const file = Buffer.concat([head, box('mdat', image, exif, xmp)]);
  const blankExif = Buffer.alloc(exif.length);
  Buffer.concat([u32(0), text('MM'), u16(42), u32(8)]).copy(blankExif);
  const blankXmp = Buffer.alloc(xmp.length, ' ');
  text(
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"/><?xpacket end="w"?>',
  ).copy(blankXmp);
  const cleaned = Buffer.concat([head, box('mdat', image, blankExif, blankXmp)]);
  return { file, cleaned, width: 48, height: 64 };
}
