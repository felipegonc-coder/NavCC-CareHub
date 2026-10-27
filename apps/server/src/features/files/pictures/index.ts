import { PictureError, type CleanedPicture, type CleanerResult, type PictureFile } from './bytes';
import { cleanJpeg } from './jpeg';
import { cleanPng } from './png';

export { PictureError, type CleanedPicture, type Piece } from './bytes';
export { redrawPicture, REDRAW_MAX_PIXELS } from './redraw';

/** The largest width or height kept (a PostgreSQL integer). */
const MAX_SIDE = 2 ** 31 - 1;

const CLEANERS: Readonly<Record<string, (file: PictureFile) => Promise<CleanerResult>>> = {
  'image/jpeg': cleanJpeg,
  'image/png': cleanPng,
};

/**
 * Plans a copy of a picture without its location, camera and other details, keeping its pixels,
 * colours and orientation untouched (Data settings 3.3, DS-07), and reads its shown size. Null for
 * pictures it doesn't take apart (SVG). A PictureError when the picture is damaged.
 */
export async function cleanPicture(
  mimeType: string,
  file: PictureFile,
): Promise<CleanedPicture | null> {
  const clean = CLEANERS[mimeType];
  if (!clean) return null;
  try {
    const { width, height, orientation = 1, sideways, pieces } = await clean(file);
    const fits = (side: number) => side >= 1 && side <= MAX_SIDE;
    if (!fits(width) || !fits(height)) return { width: null, height: null, orientation, pieces };
    return sideways
      ? { width: height, height: width, orientation, pieces }
      : { width, height, orientation, pieces };
  } catch (error) {
    throw error instanceof RangeError ? new PictureError() : error;
  }
}
