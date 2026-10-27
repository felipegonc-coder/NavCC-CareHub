import { describe, expect, it } from 'vitest';
import preset from '../tailwind-preset';
import {
  colorClasses,
  colorNames,
  colorVariables,
  coverGradients,
  coverNames,
  darkColors,
  darkTokens,
  hexToChannels,
  isColorName,
  isCoverName,
  lightColors,
  lightTokens,
  type ColorSet,
  type TokenSet,
} from '../src';

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = hexToChannels(hex)
    .split(' ')
    .map((channel) => {
      const value = Number(channel) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const themes: [string, ColorSet, TokenSet][] = [
  ['light', lightColors, lightTokens],
  ['dark', darkColors, darkTokens],
];

describe('picked colours', () => {
  it('uses the database option names, in order', () => {
    expect(colorNames).toEqual([
      'default',
      'gray',
      'brown',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
      'pink',
      'red',
    ]);
    expect(isColorName('blue')).toBe(true);
    expect(isColorName('teal')).toBe(false);
  });

  it.each(themes)(
    'keeps text at 4.5:1 or more on the colours (%s)',
    (_theme: string, colors: ColorSet, tokens: TokenSet) => {
      const surfaces = [tokens.bg, tokens.sidebar, tokens.fill, tokens['fill-hover']];
      for (const name of colorNames) {
        const { text, bg } = colors[name];
        for (const surface of [bg, ...surfaces]) {
          expect(contrast(text, surface), `${name} text on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(tokens.fg, bg), `text on ${name} background`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('sets two CSS variables per colour', () => {
    const variables = colorVariables(darkColors);
    expect(Object.keys(variables)).toHaveLength(colorNames.length * 2);
    expect(variables['--ch-blue-text']).toBe(hexToChannels(darkColors.blue.text));
    expect(variables['--ch-red-bg']).toBe(hexToChannels(darkColors.red.bg));
  });

  it('has Tailwind classes, written out in full, that the preset knows', () => {
    const colors = preset.theme.extend.colors as Record<string, string>;
    for (const name of colorNames) {
      expect(colorClasses[name]).toEqual({ text: `text-${name}-text`, bg: `bg-${name}-bg` });
      expect(colors[`${name}-text`]).toBe(`rgb(var(--ch-${name}-text) / <alpha-value>)`);
      expect(colors[`${name}-bg`]).toBe(`rgb(var(--ch-${name}-bg) / <alpha-value>)`);
    }
    expect(colors.fg).toBe('rgb(var(--ch-fg) / <alpha-value>)');
  });
});

describe('covers', () => {
  it('has six to eight preset gradients', () => {
    expect(coverNames.length).toBeGreaterThanOrEqual(6);
    expect(coverNames.length).toBeLessThanOrEqual(8);
    for (const name of coverNames) {
      expect(coverGradients[name]).toMatch(
        /^linear-gradient\(135deg, #[0-9A-F]{6}, #[0-9A-F]{6}\)$/,
      );
    }
    expect(isCoverName('ocean')).toBe(true);
    expect(isCoverName('plaid')).toBe(false);
  });
});
