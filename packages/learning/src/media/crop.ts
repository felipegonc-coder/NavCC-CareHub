import type { PixelSize } from './image-size';

/** A rectangle in pixels; x and y are its top-left corner. */
export type CropRect = { x: number; y: number; width: number; height: number };

/** Aspect presets for the crop dialog. */
export const CROP_ASPECTS = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '1:1', label: 'Square', ratio: 1 },
] as const;
export type CropAspect = (typeof CROP_ASPECTS)[number]['id'];

/** A cropped picture is at most this many pixels wide or tall. */
export const CROP_MAX_OUTPUT_SIDE = 2560;
/** The smallest selection, in display pixels. */
export const CROP_MIN_SIZE = 16;

/** Which edge or corner of the selection is being dragged. */
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const ratioOf = (aspect: CropAspect): number | null =>
  CROP_ASPECTS.find((a) => a.id === aspect)?.ratio ?? null;
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));
const finite = (value: number) => (Number.isFinite(value) ? value : 0);

/** Scales width × height down (never up) to fit inside maxWidth × maxHeight, keeping its shape. */
function fit(width: number, height: number, maxWidth: number, maxHeight: number): PixelSize {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}

/** The largest selection with this aspect, centred in the picture (`bounds` = the picture as displayed). */
export function initialCrop(bounds: PixelSize, aspect: CropAspect): CropRect {
  const ratio = ratioOf(aspect);
  const size =
    ratio === null
      ? bounds
      : fit(bounds.height * ratio, bounds.height, bounds.width, bounds.height);
  return { x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2, ...size };
}

/** Keeps a selection inside the picture and at least `minSize` on each side (when the picture allows). */
export function clampCrop(rect: CropRect, bounds: PixelSize, minSize = CROP_MIN_SIZE): CropRect {
  const width = clamp(finite(rect.width), Math.min(minSize, bounds.width), bounds.width);
  const height = clamp(finite(rect.height), Math.min(minSize, bounds.height), bounds.height);
  return {
    x: clamp(finite(rect.x), 0, bounds.width - width),
    y: clamp(finite(rect.y), 0, bounds.height - height),
    width,
    height,
  };
}

/** Moves a selection by dx, dy (dragging or arrow keys), stopping at the picture's edges. */
export function moveCrop(rect: CropRect, dx: number, dy: number, bounds: PixelSize): CropRect {
  return clampCrop({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds, 0);
}

/** Changes the aspect, keeping the selection's centre and about the same area, inside the picture. */
export function changeCropAspect(
  rect: CropRect,
  aspect: CropAspect,
  bounds: PixelSize,
  minSize = CROP_MIN_SIZE,
): CropRect {
  const ratio = ratioOf(aspect);
  if (ratio === null) return clampCrop(rect, bounds, minSize);
  const area = Math.max(rect.width * rect.height, minSize * minSize * Math.max(ratio, 1 / ratio));
  const size = fit(Math.sqrt(area * ratio), Math.sqrt(area / ratio), bounds.width, bounds.height);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return clampCrop({ x: cx - size.width / 2, y: cy - size.height / 2, ...size }, bounds, 0);
}

/**
 * Resizes a selection by dragging `handle` by dx, dy. The opposite edge or corner stays put (edges with a fixed
 * aspect grow from the middle), the aspect is kept, and the selection stays inside the picture.
 */
export function resizeCrop(
  rect: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  bounds: PixelSize,
  aspect: CropAspect,
  minSize = CROP_MIN_SIZE,
): CropRect {
  const ratio = ratioOf(aspect);
  const east = handle.includes('e');
  const west = handle.includes('w');
  const south = handle.includes('s');
  const north = handle.includes('n');
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  let width = east ? rect.width + dx : west ? rect.width - dx : rect.width;
  let height = south ? rect.height + dy : north ? rect.height - dy : rect.height;
  // Room from the fixed edge (or from the centre line, for an edge handle with a fixed aspect).
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  let maxWidth = east ? bounds.width - rect.x : west ? right : bounds.width;
  let maxHeight = south ? bounds.height - rect.y : north ? bottom : bounds.height;
  if (ratio !== null) {
    if (!east && !west) maxWidth = 2 * Math.min(cx, bounds.width - cx);
    if (!north && !south) maxHeight = 2 * Math.min(cy, bounds.height - cy);
    // Corners follow the direction the pointer moved most; edges follow their own direction.
    const horizontal = east || west;
    const vertical = north || south;
    const byWidth =
      horizontal &&
      (!vertical || Math.abs(width / rect.width - 1) >= Math.abs(height / rect.height - 1));
    if (byWidth) height = width / ratio;
    else width = height * ratio;
    const minWidth = ratio >= 1 ? minSize * ratio : minSize; // the shorter side is at least minSize
    if (width < minWidth) {
      width = minWidth;
      height = width / ratio;
    }
    ({ width, height } = fit(width, height, maxWidth, maxHeight));
  } else {
    width = clamp(width, Math.min(minSize, maxWidth), maxWidth);
    height = clamp(height, Math.min(minSize, maxHeight), maxHeight);
  }
  const x = east ? rect.x : west ? right - width : cx - width / 2;
  const y = south ? rect.y : north ? bottom - height : cy - height / 2;
  return clampCrop({ x, y, width, height }, bounds, 0);
}

/** The selection (in display pixels) as whole pixels of the original picture. */
export function cropToSource(rect: CropRect, display: PixelSize, source: PixelSize): CropRect {
  const sx = display.width > 0 ? source.width / display.width : 1;
  const sy = display.height > 0 ? source.height / display.height : 1;
  const left = clamp(Math.round(rect.x * sx), 0, source.width - 1);
  const top = clamp(Math.round(rect.y * sy), 0, source.height - 1);
  const right = clamp(Math.round((rect.x + rect.width) * sx), left + 1, source.width);
  const bottom = clamp(Math.round((rect.y + rect.height) * sy), top + 1, source.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The size of the cropped picture: the source area scaled down to `maxSide`, in the exact aspect when one is set. */
export function cropOutputSize(
  source: CropRect,
  aspect: CropAspect,
  maxSide = CROP_MAX_OUTPUT_SIDE,
): PixelSize {
  const ratio = ratioOf(aspect) ?? source.width / source.height;
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  if (ratio >= 1) {
    const width = Math.max(1, Math.round(source.width * scale));
    return { width, height: Math.max(1, Math.round(width / ratio)) };
  }
  const height = Math.max(1, Math.round(source.height * scale));
  return { width: Math.max(1, Math.round(height * ratio)), height };
}

/** Everything the crop dialog needs to draw the result: which part of the original, and at what size. */
export function planCrop(
  selection: CropRect,
  display: PixelSize,
  source: PixelSize,
  aspect: CropAspect,
  maxSide = CROP_MAX_OUTPUT_SIDE,
): { source: CropRect; output: PixelSize } {
  const area = cropToSource(clampCrop(selection, display, 0), display, source);
  return { source: area, output: cropOutputSize(area, aspect, maxSide) };
}
