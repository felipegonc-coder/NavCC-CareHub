// Runs in a worker thread (redraw.ts), so a large picture never holds up the server. It draws a picture's
// pixels into a new file: nothing else from the original is kept (uploads from people who aren't signed
// in, decision 0200). Tests run this source file in Node as it is, so it imports packages only.
import { parentPort, workerData } from 'node:worker_threads';
import jpeg from 'jpeg-js';
import pngjs from 'pngjs';

export interface RedrawJob {
  mimeType: 'image/jpeg' | 'image/png';
  bytes: Uint8Array;
  /** The Exif orientation, 1 to 8: the new picture is drawn the way up it's shown. */
  orientation: number;
  maxPixels: number;
}

export interface Redrawn {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Four bytes a pixel: red, green, blue and opacity. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Fine detail is kept; files stay a reasonable size. */
const JPEG_QUALITY = 90;

/**
 * The pixels turned and mirrored as Exif `orientation` says, so they can be stored the way up they're
 * shown. Orientations 5 to 8 swap the width and height.
 */
export function upright(pixels: Pixels, orientation: number): Pixels {
  const { width, height, data } = pixels;
  if (!Number.isInteger(orientation) || orientation < 2 || orientation > 8) return pixels;
  // Where the pixel at (x, y) of the result comes from: x and y each step through the source.
  const [xx, xy, yx, yy] = (
    [
      [-1, 0, 0, 1], // 2: mirrored left to right
      [-1, 0, 0, -1], // 3: upside down
      [1, 0, 0, -1], // 4: mirrored top to bottom
      [0, 1, 1, 0], // 5: mirrored across the diagonal from the top left
      [0, 1, -1, 0], // 6: a quarter turn clockwise
      [0, -1, -1, 0], // 7: mirrored across the diagonal from the top right
      [0, -1, 1, 0], // 8: a quarter turn anticlockwise
    ] as const
  )[orientation - 2] ?? [1, 0, 0, 1];
  const sideways = orientation >= 5;
  const outWidth = sideways ? height : width;
  const outHeight = sideways ? width : height;
  const stored = aligned(data);
  const source = new Uint32Array(stored.buffer, stored.byteOffset, width * height);
  const result = new Uint32Array(width * height);
  // Steps through the source for one pixel right and one down in the result, and where it starts.
  const right = yx * width + xx;
  const down = yy * width + xy;
  const first = (yx + yy < 0 ? height - 1 : 0) * width + (xx + xy < 0 ? width - 1 : 0);
  for (let y = 0; y < outHeight; y += 1) {
    let from = first + y * down;
    const row = y * outWidth;
    for (let x = 0; x < outWidth; x += 1) {
      result[row + x] = source[from] ?? 0;
      from += right;
    }
  }
  return { width: outWidth, height: outHeight, data: new Uint8Array(result.buffer) };
}

/** The same bytes, starting at a multiple of 4 (a copy only when they don't). */
const aligned = (data: Uint8Array): Uint8Array =>
  data.byteOffset % 4 === 0 ? data : new Uint8Array(data);

function read(job: RedrawJob): Pixels {
  if (job.mimeType === 'image/jpeg') {
    return jpeg.decode(job.bytes, {
      useTArray: true,
      maxResolutionInMP: job.maxPixels / 1_000_000,
      maxMemoryUsageInMB: 512,
    });
  }
  const png = pngjs.PNG.sync.read(
    Buffer.from(job.bytes.buffer, job.bytes.byteOffset, job.bytes.length),
  );
  if (png.width * png.height > job.maxPixels) throw new Error('The picture has too many pixels.');
  return { width: png.width, height: png.height, data: png.data };
}

function write(mimeType: RedrawJob['mimeType'], { width, height, data }: Pixels): Uint8Array {
  if (mimeType === 'image/jpeg') {
    return jpeg.encode({ width, height, data }, JPEG_QUALITY).data;
  }
  const png = new pngjs.PNG();
  png.width = width;
  png.height = height;
  png.data = Buffer.from(data.buffer, data.byteOffset, data.length);
  let opaque = true;
  for (let at = 3; at < data.length && opaque; at += 4) opaque = data[at] === 255;
  // Without transparency, three bytes a pixel are enough.
  return pngjs.PNG.sync.write(png, { colorType: opaque ? 2 : 6 });
}

/** A new picture with the same pixels, drawn upright, and its size. */
export function redraw(job: RedrawJob): Redrawn {
  const pixels = upright(read(job), job.orientation);
  return { bytes: write(job.mimeType, pixels), width: pixels.width, height: pixels.height };
}

const isJob = (value: unknown): value is RedrawJob => {
  const job = value as Partial<RedrawJob> | null;
  return (
    (job?.mimeType === 'image/jpeg' || job?.mimeType === 'image/png') &&
    job.bytes instanceof Uint8Array &&
    typeof job.orientation === 'number' &&
    typeof job.maxPixels === 'number'
  );
};

// Started by redraw.ts with a job; imported anywhere else (tests), it does nothing.
if (parentPort && isJob(workerData)) {
  parentPort.postMessage(redraw(workerData));
}
