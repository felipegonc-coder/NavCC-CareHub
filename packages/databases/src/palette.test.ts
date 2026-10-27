import { describe, expect, it } from 'vitest';
import {
  MIN_CHART_CONTRAST,
  MIN_TEXT_CONTRAST,
  OPTION_PALETTE,
  THEMES,
  THEME_COLORS,
  contrastRatio,
  relativeLuminance,
  type Swatch,
  type Theme,
} from './palette';
import { OPTION_COLORS, type OptionColor } from './types';

type Entry = { color: OptionColor; theme: Theme; swatch: Swatch };
const swatches: Entry[] = OPTION_COLORS.flatMap((color) =>
  THEMES.map((theme) => ({ color, theme, swatch: OPTION_PALETTE[color][theme] })),
);

/** Every text-on-background pair the palette promises, named for the failure message. */
type Pair = { name: string; text: string; background: string };
const textPairs: Pair[] = swatches.flatMap(({ color, theme, swatch }) => {
  const { text, mutedText } = THEME_COLORS[theme];
  const tints = ['column', 'row', 'cell'] as const satisfies readonly (keyof Swatch)[];
  return [
    { name: `${theme} ${color} chip text on chip`, text: swatch.chipText, background: swatch.chip },
    ...tints.flatMap((tint) => [
      { name: `${theme} ${color} text on ${tint}`, text, background: swatch[tint] },
      {
        name: `${theme} ${color} muted text on ${tint}`,
        text: mutedText,
        background: swatch[tint],
      },
    ]),
  ];
});

describe('contrastRatio', () => {
  it('follows WCAG 2: black on white is 21, a color on itself is 1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
    expect(contrastRatio('#3A2D25', '#3A2D25')).toBe(1);
  });

  it('matches known values around the 4.5:1 line', () => {
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(MIN_TEXT_CONTRAST);
  });

  it("doesn't depend on the order", () => {
    expect(contrastRatio('#155484', '#D6E8F5')).toBe(contrastRatio('#D6E8F5', '#155484'));
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBe(1);
  });

  it('weighs green most and blue least', () => {
    expect(relativeLuminance('#00FF00')).toBeCloseTo(0.7152, 4);
    expect(relativeLuminance('#FF0000')).toBeCloseTo(0.2126, 4);
    expect(relativeLuminance('#0000FF')).toBeCloseTo(0.0722, 4);
  });

  it('uses the straight part of the sRGB curve for very dark channels', () => {
    expect(relativeLuminance('#0A0A0A')).toBeCloseTo(10 / 255 / 12.92, 6);
  });

  it('reads #RGB and any case', () => {
    expect(relativeLuminance('#fa0')).toBe(relativeLuminance('#FFAA00'));
    expect(relativeLuminance('#d6e8f5')).toBe(relativeLuminance('#D6E8F5'));
  });

  it.each(['', 'red', '#12345', '#GGGGGG', '123456', '#1234567'])('refuses %j', (bad) => {
    expect(() => relativeLuminance(bad)).toThrow(`Not a color: "${bad}"`);
  });
});

describe('option palette', () => {
  it('has a light and a dark swatch for every option color', () => {
    expect(Object.keys(OPTION_PALETTE)).toEqual([...OPTION_COLORS]);
    expect(swatches).toHaveLength(20);
    for (const { swatch } of swatches) {
      expect(Object.keys(swatch)).toEqual(['chip', 'chipText', 'column', 'row', 'cell', 'chart']);
      for (const value of Object.values(swatch)) expect(value).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('checks every text and background pair (120 of them)', () => {
    expect(textPairs).toHaveLength(OPTION_COLORS.length * THEMES.length * 7);
  });

  it.each(textPairs)('$name reaches 4.5:1', ({ text, background }: Pair) => {
    expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it.each(THEMES)('text and muted text reach 4.5:1 on the %s page', (theme: Theme) => {
    const { background, text, mutedText } = THEME_COLORS[theme];
    expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio(mutedText, background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it.each(swatches)('$theme $color chart color reaches 3:1 against the page', (s: Entry) => {
    const page = THEME_COLORS[s.theme].background;
    expect(contrastRatio(s.swatch.chart, page)).toBeGreaterThanOrEqual(MIN_CHART_CONTRAST);
  });

  it.each(swatches)(
    '$theme $color tints stand out from the page, cell more than row',
    (s: Entry) => {
      const page = THEME_COLORS[s.theme].background;
      const row = contrastRatio(s.swatch.row, page);
      expect(row).toBeGreaterThan(1);
      expect(contrastRatio(s.swatch.cell, page)).toBeGreaterThan(row);
    },
  );

  it('gives every color its own chip and chart color in each theme', () => {
    for (const theme of THEMES) {
      const of = (key: keyof Swatch) => OPTION_COLORS.map((c) => OPTION_PALETTE[c][theme][key]);
      expect(new Set(of('chip')).size).toBe(OPTION_COLORS.length);
      expect(new Set(of('chart')).size).toBe(OPTION_COLORS.length);
    }
  });
});
