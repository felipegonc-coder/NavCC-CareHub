import { describe, expect, it } from 'vitest';
import {
  CHART_BACKGROUNDS,
  CHART_MIN_CONTRAST,
  CHART_PALETTES,
  EMPTY_COLOR,
  OPTION_CHART_COLORS,
  OTHER_COLOR,
  contrastRatio,
  isReadableChartColor,
  paletteColor,
  paletteColors,
  relativeLuminance,
  type ChartColor,
} from './chart-palette';
import { OPTION_COLORS } from './types';

const named: [string, ChartColor][] = [
  ...OPTION_COLORS.map((name): [string, ChartColor] => [
    `option ${name}`,
    OPTION_CHART_COLORS[name],
  ]),
  ...CHART_PALETTES.flatMap((p) =>
    paletteColors(p).map((color, i): [string, ChartColor] => [`${p} ${i}`, color]),
  ),
  ['other', OTHER_COLOR],
  ['empty', EMPTY_COLOR],
];

describe('chart colors', () => {
  it('has a chart color for every option color', () => {
    expect(Object.keys(OPTION_CHART_COLORS).sort()).toEqual([...OPTION_COLORS].sort());
  });

  it.each(named)('%s keeps 3:1 contrast on every background in light and dark', (_, color) => {
    for (const bg of CHART_BACKGROUNDS.light) {
      expect(contrastRatio(color.light, bg) ?? 0).toBeGreaterThanOrEqual(CHART_MIN_CONTRAST);
    }
    for (const bg of CHART_BACKGROUNDS.dark) {
      expect(contrastRatio(color.dark, bg) ?? 0).toBeGreaterThanOrEqual(CHART_MIN_CONTRAST);
    }
    expect(isReadableChartColor(color)).toBe(true);
  });

  it('uses six-digit lower-case hex everywhere', () => {
    for (const [, color] of named) {
      expect(/^#[0-9a-f]{6}$/.test(color.light)).toBe(true);
      expect(/^#[0-9a-f]{6}$/.test(color.dark)).toBe(true);
    }
  });

  it('has no repeated colors inside a palette', () => {
    for (const p of CHART_PALETTES) {
      const colors = paletteColors(p);
      expect(new Set(colors.map((x) => x.light)).size).toBe(colors.length);
      expect(new Set(colors.map((x) => x.dark)).size).toBe(colors.length);
    }
  });

  it('keeps Other and No value apart from each other', () => {
    expect(OTHER_COLOR.light).not.toBe(EMPTY_COLOR.light);
    expect(OTHER_COLOR.dark).not.toBe(EMPTY_COLOR.dark);
  });
});

describe('paletteColor', () => {
  it('goes through the palette in order and repeats', () => {
    const colors = paletteColors('default');
    expect(colors).toHaveLength(10);
    expect(paletteColor('default', 0)).toEqual(colors[0]);
    expect(paletteColor('default', 3)).toEqual(colors[3]);
    expect(paletteColor('default', 10)).toEqual(colors[0]);
    expect(paletteColor('default', 23)).toEqual(colors[3]);
  });

  it('repeats the shorter palettes after their own length', () => {
    expect(paletteColors('colorblind')).toHaveLength(8);
    expect(paletteColor('colorblind', 8)).toEqual(paletteColor('colorblind', 0));
    expect(paletteColor('mono', 9)).toEqual(paletteColor('mono', 1));
  });

  it('falls back to the default palette and to the first color for odd input', () => {
    const first = paletteColors('default')[0];
    expect(paletteColor(undefined, 0)).toEqual(first);
    expect(paletteColor('neon' as never, 0)).toEqual(first);
    expect(paletteColors('neon' as never)).toEqual(paletteColors('default'));
    expect(paletteColor('default', -1)).toEqual(paletteColors('default')[9]);
    expect(paletteColor('default', Number.NaN)).toEqual(first);
    expect(paletteColor('default', 2.7)).toEqual(paletteColors('default')[2]);
  });

  it('gives each palette its own first color', () => {
    const firsts = CHART_PALETTES.map((p) => paletteColor(p, 0).light);
    expect(new Set(firsts).size).toBe(CHART_PALETTES.length);
  });
});

describe('contrast maths', () => {
  it('matches the WCAG reference points', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
    expect(relativeLuminance('#fff')).toBe(1);
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#000')).toBe(21);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    // #767676 on white is the well-known 4.54:1 gray.
    expect((contrastRatio('#767676', '#ffffff') ?? 0).toFixed(2)).toBe('4.54');
  });

  it('rejects anything that is not a hex color', () => {
    expect(relativeLuminance('blue')).toBeNull();
    expect(relativeLuminance('#12345')).toBeNull();
    expect(relativeLuminance('123456')).toBeNull();
    expect(contrastRatio('#ffffff', 'red')).toBeNull();
    expect(isReadableChartColor({ light: 'nope', dark: '#ffffff' })).toBe(false);
  });

  it('turns down colors that fade into the background', () => {
    expect(isReadableChartColor({ light: '#d9d9d9', dark: '#5b97e0' })).toBe(false);
    expect(isReadableChartColor({ light: '#2f73c9', dark: '#2a2a2a' })).toBe(false);
    expect(isReadableChartColor({ light: '#2f73c9', dark: '#5b97e0' })).toBe(true);
  });
});
