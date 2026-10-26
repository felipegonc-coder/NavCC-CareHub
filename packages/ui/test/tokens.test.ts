import { describe, expect, it } from 'vitest';
import { cssVariables, darkTokens, hexToChannels, lightTokens, type TokenSet } from '../src';

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

const themes: [string, TokenSet][] = [
  ['light', lightTokens],
  ['dark', darkTokens],
];

describe('tokens', () => {
  it('uses the colours from the look-and-feel spec', () => {
    expect(lightTokens).toMatchObject({
      bg: '#FFFFFF',
      fg: '#0A0A0A',
      faint: '#A3A3A3',
      border: '#E5E5E5',
      'border-hover': '#D4D4D4',
      sidebar: '#FAFAFA',
      'fill-hover': '#F5F5F5',
      primary: '#171717',
      'primary-hover': '#404040',
    });
    expect(darkTokens).toMatchObject({
      bg: '#0A0A0A',
      fg: '#FAFAFA',
      muted: '#A3A3A3',
      border: '#262626',
      sidebar: '#18181B',
      primary: '#FAFAFA',
    });
  });

  it.each(themes)(
    'keeps text at 4.5:1 or more on every surface (%s)',
    (_name: string, tokens: TokenSet) => {
      const surfaces = [tokens.bg, tokens.sidebar, tokens.fill, tokens['fill-hover']];
      for (const text of [tokens.fg, tokens.muted, tokens.danger, tokens.success, tokens.warning]) {
        for (const surface of surfaces) expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(tokens['primary-fg'], tokens.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens['primary-fg'], tokens['primary-hover'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens.bg, tokens.danger)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(themes)('keeps the focus ring at 3:1 or more (%s)', (_name: string, tokens: TokenSet) => {
    for (const surface of [tokens.bg, tokens.sidebar, tokens['fill-hover']]) {
      expect(contrast(tokens.ring, surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it('turns hex into CSS variables with RGB channels', () => {
    expect(hexToChannels('#0A0A0A')).toBe('10 10 10');
    expect(cssVariables(lightTokens)['--ch-fg']).toBe('10 10 10');
    expect(cssVariables(darkTokens)['--ch-bg']).toBe('10 10 10');
  });
});
