import { describe, expect, it } from 'vitest';
import {
  CHART_PALETTES,
  EMPTY_COLOR,
  OTHER_COLOR,
  paletteColor,
  paletteColors,
  type ChartColor,
} from './chart-palette';
import { OPTION_COLORS } from './types';

const all: [string, ChartColor][] = [
  ...CHART_PALETTES.flatMap((p) =>
    paletteColors(p).map((color, i): [string, ChartColor] => [`${p} ${i}`, color]),
  ),
  ['other', OTHER_COLOR],
  ['empty', EMPTY_COLOR],
];
const same = (a: ChartColor | undefined, b: ChartColor | undefined): boolean =>
  a?.color === b?.color && (a?.strength ?? 5) === (b?.strength ?? 5);

describe('chart palettes', () => {
  it.each(all)('%s is a design-kit colour name with a strength from 1 to 5', (_, c) => {
    expect((OPTION_COLORS as readonly string[]).includes(c.color)).toBe(true);
    if (c.strength !== undefined) {
      expect(Number.isInteger(c.strength)).toBe(true);
      expect(c.strength).toBeGreaterThanOrEqual(1);
      expect(c.strength).toBeLessThanOrEqual(5);
    }
    expect(Object.keys(c).every((k) => k === 'color' || k === 'strength')).toBe(true);
  });

  it('has no hex colours', () => {
    expect(JSON.stringify(all)).not.toContain('#');
  });

  it('keeps gray and default for "Other" and "No value", which look different', () => {
    expect(OTHER_COLOR).toEqual({ color: 'gray' });
    expect(EMPTY_COLOR).toEqual({ color: 'default', strength: 2 });
    for (const p of CHART_PALETTES) {
      for (const c of paletteColors(p)) expect(['gray', 'default']).not.toContain(c.color);
    }
  });

  it('never puts the same colour next to itself, including where a palette repeats', () => {
    for (const p of CHART_PALETTES) {
      const colors = paletteColors(p);
      colors.forEach((c, i) => {
        expect(same(c, colors[(i + 1) % colors.length])).toBe(false);
      });
    }
  });

  it('has no repeated colours inside a palette', () => {
    for (const p of CHART_PALETTES) {
      const colors = paletteColors(p);
      const seen = new Set(colors.map((c) => `${c.color}:${c.strength ?? 5}`));
      expect(seen.size).toBe(colors.length);
    }
  });

  it('starts every palette with a solid colour', () => {
    for (const p of CHART_PALETTES) expect(paletteColors(p)[0]?.strength).toBeUndefined();
  });

  it('uses one hue for mono, every strength once', () => {
    const mono = paletteColors('mono');
    expect(new Set(mono.map((c) => c.color)).size).toBe(1);
    expect(mono.map((c) => c.strength ?? 5).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps the colorblind palette to blue and orange, then purple and yellow', () => {
    const blueSide = ['blue', 'purple'];
    const colors = paletteColors('colorblind');
    colors.forEach((c, i) => {
      const next = colors[(i + 1) % colors.length];
      expect(blueSide.includes(c.color)).not.toBe(blueSide.includes(next?.color ?? ''));
    });
  });
});

describe('paletteColor', () => {
  it('goes through the sequence in order and repeats', () => {
    const colors = paletteColors('default');
    expect(colors).toHaveLength(16);
    expect(paletteColor('default', 0)).toEqual({ color: 'blue' });
    expect(paletteColor('default', 1)).toEqual({ color: 'orange' });
    expect(paletteColor('default', 8)).toEqual({ color: 'blue', strength: 3 });
    expect(paletteColor('default', 16)).toEqual(colors[0]);
    expect(paletteColor('mono', 6)).toEqual(paletteColor('mono', 1));
    expect(paletteColor('colorblind', 8)).toEqual(paletteColor('colorblind', 0));
  });

  it('gives Colorful the same sequence as Auto', () => {
    expect(paletteColors('colorful')).toEqual(paletteColors('default'));
  });

  it('falls back to Auto and to the first colour for odd input', () => {
    const first = paletteColors('default')[0];
    expect(paletteColor(undefined, 0)).toEqual(first);
    expect(paletteColor('neon' as never, 0)).toEqual(first);
    expect(paletteColors('neon' as never)).toEqual(paletteColors('default'));
    expect(paletteColor('default', -1)).toEqual(paletteColors('default')[15]);
    expect(paletteColor('default', Number.NaN)).toEqual(first);
    expect(paletteColor('default', 2.7)).toEqual(paletteColors('default')[2]);
  });

  it('hands out copies, so changing one leaves the palette alone', () => {
    const c = paletteColor('mono', 1);
    c.strength = 5;
    expect(paletteColor('mono', 1)).toEqual({ color: 'blue', strength: 3 });
  });
});
