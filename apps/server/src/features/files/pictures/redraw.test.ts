import jpeg from 'jpeg-js';
import pngjs from 'pngjs';
import { describe, expect, it } from 'vitest';
import { PictureError } from './bytes';
import { upright, type Pixels } from './picture-worker';
import { pngChunk } from './png';
import { redrawPicture } from './redraw';
import { DETAIL, sampleExif, samplePhoto } from './testing';

/** Pixels of one colour each: `rows` of letters, r for red and b for blue. */
function drawn(rows: string[]): Pixels {
  const colours: Record<string, number[]> = { r: [220, 20, 20, 255], b: [20, 20, 220, 255] };
  const data = Uint8Array.from(rows.flatMap((row) => [...row].flatMap((c) => colours[c] ?? [])));
  return { width: rows[0]?.length ?? 0, height: rows.length, data };
}

/** The letters of a picture's pixels: r where red is strongest, b where blue is. */
function letters({ width, height, data }: Pixels): string[] {
  const rows: string[] = [];
  for (let y = 0; y < height; y += 1) {
    let row = '';
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      row += (data[at] ?? 0) > (data[at + 2] ?? 0) ? 'r' : 'b';
    }
    rows.push(row);
  }
  return rows;
}

/** A PNG of `rows`, with Exif (orientation 6) and a text chunk holding details. */
function scan(rows: string[], opacity = 255): Buffer {
  const pixels = drawn(rows);
  for (let at = 3; at < pixels.data.length; at += 4) pixels.data[at] = opacity;
  const png = new pngjs.PNG();
  png.width = pixels.width;
  png.height = pixels.height;
  png.data = Buffer.from(pixels.data);
  const plain = pngjs.PNG.sync.write(png);
  const details = [
    pngChunk('eXIf', sampleExif(6)),
    pngChunk('tEXt', Buffer.from(`Location\0${DETAIL}`, 'latin1')),
  ];
  return Buffer.concat([plain.subarray(0, 33), ...details, plain.subarray(33)]);
}

describe('upright', () => {
  // 1 2 3
  // 4 5 6
  const numbered: Pixels = {
    width: 3,
    height: 2,
    data: Uint8Array.from([1, 2, 3, 4, 5, 6].flatMap((n) => [n, 0, 0, 255])),
  };
  const grid = ({ width, data }: Pixels) => {
    const values = [...data].filter((_, at) => at % 4 === 0);
    return Array.from({ length: values.length / width }, (_, y) =>
      values.slice(y * width, (y + 1) * width).join(' '),
    );
  };

  it('turns and mirrors pixels as each Exif orientation says', () => {
    expect(grid(upright(numbered, 1))).toEqual(['1 2 3', '4 5 6']);
    expect(grid(upright(numbered, 2))).toEqual(['3 2 1', '6 5 4']);
    expect(grid(upright(numbered, 3))).toEqual(['6 5 4', '3 2 1']);
    expect(grid(upright(numbered, 4))).toEqual(['4 5 6', '1 2 3']);
    expect(grid(upright(numbered, 5))).toEqual(['1 4', '2 5', '3 6']);
    expect(grid(upright(numbered, 6))).toEqual(['4 1', '5 2', '6 3']);
    expect(grid(upright(numbered, 7))).toEqual(['6 3', '5 2', '4 1']);
    expect(grid(upright(numbered, 8))).toEqual(['3 6', '2 5', '1 4']);
  });

  it('leaves pixels as they are for unknown orientations', () => {
    expect(upright(numbered, 0)).toBe(numbered);
    expect(upright(numbered, 9)).toBe(numbered);
  });
});

describe('redrawPicture', () => {
  it('draws a JPEG again, upright, without its details', async () => {
    const redrawn = await redrawPicture('image/jpeg', samplePhoto(), 6);
    expect([redrawn.width, redrawn.height]).toEqual([8, 16]);
    const bytes = Buffer.from(redrawn.bytes);
    expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(bytes.includes(DETAIL)).toBe(false);
    expect(bytes.includes('Exif')).toBe(false);
    const pixels = jpeg.decode(bytes, { useTArray: true });
    expect([pixels.width, pixels.height]).toEqual([8, 16]);
    const rows = letters(pixels);
    expect(rows.slice(1, 7)).toEqual(Array.from({ length: 6 }, () => 'rrrrrrrr'));
    expect(rows.slice(9, 15)).toEqual(Array.from({ length: 6 }, () => 'bbbbbbbb'));
  });

  it('draws a PNG again with the same pixels, upright, without its details', async () => {
    const redrawn = await redrawPicture('image/png', scan(['rrbb', 'rrbb']), 6);
    const bytes = Buffer.from(redrawn.bytes);
    expect(bytes.includes(DETAIL)).toBe(false);
    expect(bytes.includes('eXIf')).toBe(false);
    expect(bytes[25]).toBe(2); // without transparency: three bytes a pixel
    expect(letters(pngjs.PNG.sync.read(bytes))).toEqual(['rr', 'rr', 'bb', 'bb']);
  });

  it('keeps transparency', async () => {
    const redrawn = await redrawPicture('image/png', scan(['rb'], 128), 1);
    const png = pngjs.PNG.sync.read(Buffer.from(redrawn.bytes));
    expect([png.data[3], png.data[7]]).toEqual([128, 128]);
  });

  it('refuses pictures it cannot read', async () => {
    const broken = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(64, 7)]);
    await expect(redrawPicture('image/jpeg', broken, 1)).rejects.toBeInstanceOf(PictureError);
    await expect(redrawPicture('image/png', Buffer.alloc(64, 7), 1)).rejects.toBeInstanceOf(
      PictureError,
    );
  });
});
