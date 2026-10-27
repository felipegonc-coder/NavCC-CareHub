import { describe, expect, it } from 'vitest';
import {
  CROP_ASPECTS,
  changeCropAspect,
  clampCrop,
  cropOutputSize,
  cropToSource,
  initialCrop,
  moveCrop,
  planCrop,
  resizeCrop,
  type CropRect,
} from './crop';

const bounds = { width: 800, height: 600 };
const rect = (x: number, y: number, width: number, height: number): CropRect => ({
  x,
  y,
  width,
  height,
});
/** Rounds to 2 decimals, so float noise doesn't matter. */
const round = (r: CropRect) => ({
  x: Math.round(r.x * 100) / 100,
  y: Math.round(r.y * 100) / 100,
  width: Math.round(r.width * 100) / 100,
  height: Math.round(r.height * 100) / 100,
});

describe('starting and keeping a selection', () => {
  it('offers free, 16:9, 4:3 and square', () => {
    expect(CROP_ASPECTS.map((a) => a.label)).toEqual(['Free', '16:9', '4:3', 'Square']);
  });

  it('starts with the largest centred selection of the aspect', () => {
    expect(initialCrop(bounds, 'free')).toEqual(rect(0, 0, 800, 600));
    expect(round(initialCrop(bounds, '16:9'))).toEqual(rect(0, 75, 800, 450));
    expect(initialCrop(bounds, '1:1')).toEqual(rect(100, 0, 600, 600));
    expect(round(initialCrop({ width: 600, height: 800 }, '4:3'))).toEqual(rect(0, 175, 600, 450));
  });

  it('keeps a selection inside the picture and not too small', () => {
    expect(clampCrop(rect(-10, 590, 100, 100), bounds)).toEqual(rect(0, 500, 100, 100));
    expect(clampCrop(rect(10, 10, 2, 3), bounds)).toEqual(rect(10, 10, 16, 16));
    expect(clampCrop(rect(Number.NaN, 0, 5000, Infinity), bounds)).toEqual(rect(0, 0, 800, 16));
    expect(clampCrop(rect(0, 0, 50, 50), { width: 10, height: 8 })).toEqual(rect(0, 0, 10, 8));
  });

  it('moves a selection, stopping at the edges', () => {
    expect(moveCrop(rect(100, 100, 200, 100), 25, -10, bounds)).toEqual(rect(125, 90, 200, 100));
    expect(moveCrop(rect(100, 100, 200, 100), 1000, -1000, bounds)).toEqual(rect(600, 0, 200, 100));
  });

  it('changes the aspect around the same centre and about the same area', () => {
    const square = changeCropAspect(rect(100, 100, 400, 300), '1:1', bounds);
    expect(square.width).toBeCloseTo(Math.sqrt(120_000));
    expect(square.height).toBeCloseTo(square.width);
    expect(square.x + square.width / 2).toBeCloseTo(300);
    expect(square.y + square.height / 2).toBeCloseTo(250);
    const wide = changeCropAspect(rect(0, 0, 800, 600), '16:9', bounds);
    expect(round(wide)).toEqual(rect(0, 75, 800, 450)); // too wide for the picture: scaled down to fit
    expect(changeCropAspect(rect(-5, 0, 100, 100), 'free', bounds)).toEqual(rect(0, 0, 100, 100));
  });
});

describe('resizeCrop', () => {
  const start = rect(100, 100, 400, 300);

  it('moves only the dragged edges when the aspect is free', () => {
    expect(resizeCrop(start, 'se', 50, 20, bounds, 'free')).toEqual(rect(100, 100, 450, 320));
    expect(resizeCrop(start, 'nw', 50, 20, bounds, 'free')).toEqual(rect(150, 120, 350, 280));
    expect(resizeCrop(start, 'n', 0, -500, bounds, 'free')).toEqual(rect(100, 0, 400, 400));
    expect(resizeCrop(start, 'e', 1000, 0, bounds, 'free')).toEqual(rect(100, 100, 700, 300));
    expect(resizeCrop(start, 'w', 1000, 0, bounds, 'free')).toEqual(rect(484, 100, 16, 300));
  });

  it('keeps a fixed aspect, following the direction the pointer moved most', () => {
    const square = rect(100, 100, 200, 200);
    expect(resizeCrop(square, 'se', 100, 20, bounds, '1:1')).toEqual(rect(100, 100, 300, 300));
    expect(resizeCrop(square, 'se', 10, 100, bounds, '1:1')).toEqual(rect(100, 100, 300, 300));
    expect(resizeCrop(square, 'nw', -50, -10, bounds, '1:1')).toEqual(rect(50, 50, 250, 250));
  });

  it('grows a fixed-aspect selection from the middle when an edge is dragged', () => {
    expect(resizeCrop(rect(100, 100, 200, 200), 'e', 100, 0, bounds, '1:1')).toEqual(
      rect(100, 50, 300, 300),
    );
    expect(resizeCrop(rect(100, 0, 200, 200), 'e', 100, 0, bounds, '1:1')).toEqual(
      rect(100, 0, 200, 200),
    ); // no room above
    expect(resizeCrop(rect(100, 100, 200, 200), 's', 0, 50, bounds, '1:1')).toEqual(
      rect(75, 100, 250, 250),
    );
  });

  it('stays inside the picture and at least the minimum size with a fixed aspect', () => {
    const grown = resizeCrop(rect(400, 300, 320, 180), 'se', 1000, 0, bounds, '16:9');
    expect(round(grown)).toEqual(rect(400, 300, 400, 225));
    const shrunk = resizeCrop(rect(100, 100, 320, 180), 'se', -1000, 0, bounds, '16:9');
    expect(round(shrunk)).toEqual(rect(100, 100, 28.44, 16));
    const tall = resizeCrop(rect(100, 100, 300, 300), 'nw', 1000, 1000, bounds, '1:1', 20);
    expect(tall).toEqual(rect(380, 380, 20, 20));
  });
});

describe('cropping the original picture', () => {
  it('maps the selection to whole source pixels', () => {
    const display = { width: 400, height: 300 };
    const source = { width: 4000, height: 3000 };
    expect(cropToSource(rect(10, 20, 100, 50), display, source)).toEqual(rect(100, 200, 1000, 500));
    expect(cropToSource(rect(0, 0, 400, 300), display, source)).toEqual(rect(0, 0, 4000, 3000));
    expect(cropToSource(rect(399.99, 299.99, 0.001, 0.001), display, source)).toEqual(
      rect(3999, 2999, 1, 1),
    );
    expect(cropToSource(rect(1, 1, 2, 2), { width: 0, height: 0 }, source)).toEqual(
      rect(1, 1, 2, 2),
    );
  });

  it('scales the result down to the largest side, in the exact aspect', () => {
    expect(cropOutputSize(rect(0, 0, 4000, 2250), '16:9')).toEqual({ width: 2560, height: 1440 });
    expect(cropOutputSize(rect(0, 0, 1001, 563), '16:9')).toEqual({ width: 1001, height: 563 });
    expect(cropOutputSize(rect(0, 0, 1000, 3000), 'free')).toEqual({ width: 853, height: 2560 });
    expect(cropOutputSize(rect(0, 0, 300, 300), '1:1')).toEqual({ width: 300, height: 300 });
    expect(cropOutputSize(rect(0, 0, 3000, 3000), '1:1', 1000)).toEqual({
      width: 1000,
      height: 1000,
    });
  });

  it('plans the crop from a selection on screen', () => {
    expect(
      planCrop(
        rect(-20, 0, 400, 225),
        { width: 400, height: 300 },
        { width: 4000, height: 3000 },
        '16:9',
      ),
    ).toEqual({
      source: rect(0, 0, 4000, 2250),
      output: { width: 2560, height: 1440 },
    });
  });
});
