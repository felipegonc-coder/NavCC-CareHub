import type { ReadAt } from '../detect';

/** The picture's own structure is broken, so its details can't be removed safely. */
export class PictureError extends Error {
  constructor(what = 'The picture is damaged.') {
    super(what);
    this.name = 'PictureError';
  }
}

/** A part of the new file: bytes from `start` to `end` of the original, or new bytes. */
export type Piece = Buffer | { start: number; end: number };

/** A picture's shown size, and how to rebuild it without its details. */
export interface CleanedPicture {
  /** Pixels as shown, after any rotation; null when the file doesn't say. */
  width: number | null;
  height: number | null;
  /** The new file, in order; null when there's nothing to remove. */
  pieces: Piece[] | null;
}

/** What a cleaner finds: the size as stored (0 when unknown), and whether it's shown turned a quarter. */
export interface CleanerResult {
  width: number;
  height: number;
  sideways?: boolean;
  pieces: Piece[] | null;
}

export interface PictureFile {
  size: number;
  read: ReadAt;
}

const WINDOW = 1024 * 1024;

/** Reads a file through a 1 MB window, for parsers that look at many small parts in order. */
export function windowedReader({ size, read }: PictureFile) {
  let start = 0;
  let window: Buffer = Buffer.alloc(0);
  /** `length` bytes at `offset`; a PictureError when the file ends first. */
  const bytes = async (offset: number, length: number): Promise<Buffer> => {
    if (offset < 0 || length < 0 || offset + length > size) throw new PictureError();
    if (offset < start || offset + length > start + window.length) {
      start = offset;
      window = await read(offset, Math.max(length, Math.min(WINDOW, size - offset)));
      if (window.length < length) throw new PictureError();
    }
    return window.subarray(offset - start, offset - start + length);
  };
  const byte = async (offset: number): Promise<number> => (await bytes(offset, 1))[0] ?? 0;
  return { size, bytes, byte };
}

export type WindowedReader = ReturnType<typeof windowedReader>;

/** Collects the pieces of a new file, joining neighbouring ranges. */
export function pieceList(size: number) {
  const list: Piece[] = [];
  const keep = (start: number, end: number): void => {
    if (end <= start) return;
    const last = list[list.length - 1];
    if (last && !Buffer.isBuffer(last) && last.end === start) last.end = end;
    else list.push({ start, end });
  };
  return {
    keep,
    add: (bytes: Buffer): void => void list.push(bytes),
    /** `bytes` instead of `start` to `end`; the range itself when that's what it holds already. */
    replace(start: number, end: number, original: Buffer, bytes: Buffer): void {
      if (original.equals(bytes)) keep(start, end);
      else list.push(bytes);
    },
    /** The pieces, or null when they're exactly the original file. */
    done(): Piece[] | null {
      const [only] = list;
      const same = list.length === 1 && only && !Buffer.isBuffer(only) && only.end === size;
      return same && only.start === 0 ? null : list;
    },
  };
}

/** How long the new file is. */
export const piecesLength = (pieces: readonly Piece[]): number =>
  pieces.reduce(
    (total, piece) => total + (Buffer.isBuffer(piece) ? piece.length : piece.end - piece.start),
    0,
  );
