import { MEDIA_SIZE_LIMITS, type CropRect, type PixelSize } from '@carehub/learning';

/** A picture the browser couldn't crop, with a message to show. */
export class CropError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CropError';
  }
}

const CANT_CROP =
  "This browser can't crop the picture. Try another browser, or crop it before uploading it.";
/** From 0 to 1: high enough that text in screenshots stays sharp. */
const QUALITY = 0.92;
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new CropError(CANT_CROP))),
        type,
        QUALITY,
      );
    } catch {
      reject(new CropError(CANT_CROP)); // a picture from another site can't be read back
    }
  });
}

/**
 * Draws part of a picture (`plan.source`, in the picture's own pixels) at `plan.output` size and saves it as
 * WebP, which keeps see-through parts and stays small. Browsers that can't make WebP give PNG; when that is
 * too big to upload, it is saved as JPEG instead. Saving through a canvas also drops the photo's details
 * (such as where it was taken).
 */
export async function cropImage(
  picture: CanvasImageSource,
  plan: { source: CropRect; output: PixelSize },
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = plan.output.width;
  canvas.height = plan.output.height;
  const context = canvas.getContext('2d');
  if (!context) throw new CropError(CANT_CROP);
  context.imageSmoothingQuality = 'high';
  const { x, y, width, height } = plan.source;
  context.drawImage(picture, x, y, width, height, 0, 0, canvas.width, canvas.height);
  const blob = await canvasBlob(canvas, 'image/webp');
  if (blob.type === 'image/webp' || blob.size <= MEDIA_SIZE_LIMITS.image) return blob;
  // JPEG has no see-through parts: paint them white (picture data, not a screen colour).
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvasBlob(canvas, 'image/jpeg');
}

/** The cropped copy's file name, such as "Cropped picture.webp". */
export function croppedName(type: string): string {
  return `Cropped picture.${EXTENSIONS[type] ?? 'png'}`;
}
