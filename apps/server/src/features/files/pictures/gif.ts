import {
  pieceList,
  windowedReader,
  PictureError,
  type CleanerResult,
  type PictureFile,
} from './bytes';

// A GIF is a header, the screen size and colours, then blocks: images (0x2C), extensions (0x21,
// in sub-blocks of up to 255 bytes) and the end (0x3B). Comments and application extensions (XMP
// among them) can hold details; looping and colour profiles are kept.

const IMAGE = 0x2c;
const EXTENSION = 0x21;
const END = 0x3b;
const COMMENT = 0xfe;
const APPLICATION = 0xff;
const KEPT_APPLICATIONS = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0', 'ICCRGBG1012']);

/** Bytes in a colour table, from a block's flags. */
const tableSize = (flags: number) => (flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0);

/** Keeps the images and what drawing them needs; drops comments and other applications' data. */
export async function cleanGif(file: PictureFile): Promise<CleanerResult> {
  const reader = windowedReader(file);
  const { byte, size } = reader;
  const screen = await reader.bytes(0, 13);
  /** Where a run of sub-blocks ends (a cut-off file ends there too). */
  const afterSubBlocks = async (from: number) => {
    let at = from;
    while (at < size) {
      const length = await byte(at);
      at += 1 + length;
      if (length === 0) return at;
    }
    return size;
  };
  let at = 13 + tableSize(screen[10] ?? 0);
  const out = pieceList(size);
  out.keep(0, at);
  while (at < size) {
    const kind = await byte(at);
    if (kind === END) {
      out.keep(at, at + 1); // anything after the end is left out
      break;
    }
    if (kind === IMAGE) {
      const descriptor = await reader.bytes(at, 10);
      const end = await afterSubBlocks(at + 10 + tableSize(descriptor[9] ?? 0) + 1);
      out.keep(at, end);
      at = end;
    } else if (kind === EXTENSION) {
      const label = await byte(at + 1);
      const end = await afterSubBlocks(at + 2);
      let kept = label !== COMMENT;
      if (label === APPLICATION) {
        const id = (await byte(at + 2)) === 11 ? await reader.bytes(at + 3, 11) : Buffer.alloc(0);
        kept = KEPT_APPLICATIONS.has(id.toString('latin1'));
      }
      if (kept) out.keep(at, end);
      at = end;
    } else {
      throw new PictureError();
    }
  }
  return { width: screen.readUInt16LE(6), height: screen.readUInt16LE(8), pieces: out.done() };
}
