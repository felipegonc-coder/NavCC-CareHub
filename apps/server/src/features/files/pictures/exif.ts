// Exif data is a small TIFF file: a byte order, then folders (IFDs) of numbered tags.

const ORIENTATION = 0x0112;
const SHORT = 3;

/** The Exif orientation (1 to 8) in TIFF-format Exif data, or 1 when it has none. */
export function exifOrientation(tiff: Buffer): number {
  const order = tiff.toString('latin1', 0, 2);
  if (tiff.length < 8 || (order !== 'II' && order !== 'MM')) return 1;
  const little = order === 'II';
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (u16(2) !== 42) return 1;
  const folder = u32(4);
  if (folder + 2 > tiff.length) return 1;
  for (let index = 0; index < u16(folder); index += 1) {
    const entry = folder + 2 + index * 12;
    if (entry + 12 > tiff.length) return 1;
    if (u16(entry) === ORIENTATION && u16(entry + 2) === SHORT) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** TIFF-format Exif data holding nothing but the orientation, so the picture stays upright. */
export function orientationExif(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4); // the first folder
  tiff.writeUInt16BE(1, 8); // one tag
  tiff.writeUInt16BE(ORIENTATION, 10);
  tiff.writeUInt16BE(SHORT, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  return tiff; // the last 4 bytes: no next folder
}

/** Orientations 5 to 8 turn the picture a quarter, so its width and height swap. */
export const turnsSideways = (orientation: number): boolean => orientation >= 5 && orientation <= 8;
