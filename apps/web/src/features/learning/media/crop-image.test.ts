import { describe, expect, it } from 'vitest';
import { CropError, cropImage, croppedName } from './crop-image';
import { fakeCanvas } from './testing';

const plan = {
  source: { x: 100, y: 0, width: 600, height: 600 },
  output: { width: 300, height: 300 },
};

describe('cropImage', () => {
  it('draws the chosen part at the output size, as PNG when the browser has no WebP', async () => {
    const canvas = fakeCanvas();
    try {
      const blob = await cropImage(document.createElement('img'), plan);
      expect(canvas.drawn[0]?.slice(1)).toEqual([100, 0, 600, 600, 0, 0, 300, 300]);
      expect(blob.type).toBe('image/png');
      expect(croppedName(blob.type)).toBe('Cropped picture.png');
    } finally {
      canvas.restore();
    }
  });

  it('says so when the browser has no canvas', async () => {
    const failed = await cropImage(document.createElement('img'), plan).catch(
      (error: unknown) => error,
    );
    expect(failed).toBeInstanceOf(CropError);
    expect((failed as CropError).message).toBe(
      "This browser can't crop the picture. Try another browser, or crop it before uploading it.",
    );
  });

  it('names the cropped copy by its type', () => {
    expect(croppedName('image/webp')).toBe('Cropped picture.webp');
    expect(croppedName('image/jpeg')).toBe('Cropped picture.jpg');
  });
});
