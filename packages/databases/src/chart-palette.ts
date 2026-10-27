/**
 * Chart colors (Databases spec, Chart layout): bars, lines and slices use the option colors when the
 * categories have them, otherwise a fixed readable set. Every color here keeps at least 3:1 contrast
 * against the chart backgrounds of its mode (the WCAG minimum for graphics), checked by the tests.
 */
import type { ChartOptions, OptionColor } from './types';

/** One color for each mode, as "#rrggbb". */
export interface ChartColor {
  light: string;
  dark: string;
}

export type ChartPalette = NonNullable<ChartOptions['palette']>;

/** In the order the palette picker lists them. */
export const CHART_PALETTES = [
  'default',
  'colorful',
  'colorblind',
  'mono',
] as const satisfies readonly ChartPalette[];

/** Page and card backgrounds a chart can sit on. */
export const CHART_BACKGROUNDS = {
  light: ['#ffffff', '#f7f6f3'],
  dark: ['#191919', '#252525'],
} as const;

/** Minimum contrast of a chart color against every background of its mode. */
export const CHART_MIN_CONTRAST = 3;

const c = (light: string, dark: string): ChartColor => ({ light, dark });

/** Option colors as chart fills (stronger than the option tag colors so thin bars and lines show). */
export const OPTION_CHART_COLORS: Readonly<Record<OptionColor, ChartColor>> = {
  default: c('#8a8780', '#8f8c86'),
  gray: c('#6f6e69', '#a3a29e'),
  brown: c('#9a6a4a', '#b8896a'),
  orange: c('#d0670f', '#e08a3c'),
  yellow: c('#b08300', '#d6a72c'),
  green: c('#3a8a5a', '#5fae7e'),
  blue: c('#2f73c9', '#5b97e0'),
  purple: c('#8a52c4', '#a77bdb'),
  pink: c('#c2468a', '#d872a8'),
  red: c('#d0453b', '#e4706a'),
};

const PALETTES: Readonly<Record<ChartPalette, readonly ChartColor[]>> = {
  default: [
    c('#2f73c9', '#5b97e0'),
    c('#d0670f', '#e08a3c'),
    c('#3a8a5a', '#5fae7e'),
    c('#8a52c4', '#a77bdb'),
    c('#c2468a', '#d872a8'),
    c('#1f8282', '#3fb3b3'),
    c('#a87d00', '#d6a72c'),
    c('#d0453b', '#e4706a'),
    c('#9a6a4a', '#b8896a'),
    c('#5c6f85', '#93a4b8'),
  ],
  colorful: [
    c('#1565e0', '#4d94ff'),
    c('#c2189b', '#f055c8'),
    c('#1e8a2e', '#3fcf55'),
    c('#d65a00', '#ff8a33'),
    c('#7a3cf0', '#a582ff'),
    c('#00809a', '#1fc8e8'),
    c('#e0243a', '#ff5c6c'),
    c('#a07400', '#ffc21a'),
    c('#00866a', '#2ad6a6'),
    c('#d6336c', '#ff7aa8'),
  ],
  // Based on the Okabe–Ito set, darkened for light mode where needed to keep 3:1.
  colorblind: [
    c('#b07600', '#e69f00'),
    c('#2a7db5', '#56b4e9'),
    c('#00866a', '#14b083'),
    c('#857a00', '#f0e442'),
    c('#0072b2', '#4aa0d9'),
    c('#c85700', '#f07a2a'),
    c('#b0578b', '#cc79a7'),
    c('#3d3d3d', '#cfcfcf'),
  ],
  // Shades of one blue, ordered so neighbours differ clearly.
  mono: [
    c('#0e2f5a', '#d6e6fb'),
    c('#1f5096', '#93bcef'),
    c('#173f78', '#b5d1f5'),
    c('#2961b0', '#73a7e8'),
    c('#123a6b', '#c5dcf8'),
    c('#245aa3', '#82b1eb'),
    c('#1b4886', '#a3c6f2'),
    c('#3470bf', '#5893df'),
  ],
};

/** The "Other" bar, slice or series (the categories past the limits). */
export const OTHER_COLOR: ChartColor = c('#5f5e5b', '#b4b3af');
/** The "No value" bar, slice or series. */
export const EMPTY_COLOR: ChartColor = c('#8a8a8a', '#8f8f8f');

function isPalette(p: unknown): p is ChartPalette {
  return typeof p === 'string' && (CHART_PALETTES as readonly string[]).includes(p);
}

/** The colors of a palette in order; an unknown palette gives the default one. */
export function paletteColors(palette: ChartPalette | undefined): readonly ChartColor[] {
  return PALETTES[isPalette(palette) ? palette : 'default'];
}

/** The color for the nth category or series; palettes repeat when there are more items than colors. */
export function paletteColor(palette: ChartPalette | undefined, index: number): ChartColor {
  const colors = paletteColors(palette);
  const i = Number.isFinite(index) ? Math.trunc(index) : 0;
  const n = colors.length;
  return colors[((i % n) + n) % n] ?? OTHER_COLOR;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function channels(hex: string): [number, number, number] | null {
  if (!HEX.test(hex)) return null;
  const digits =
    hex.length === 4
      ? hex
          .slice(1)
          .split('')
          .map((d) => d + d)
          .join('')
      : hex.slice(1);
  const n = Number.parseInt(digits, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const linear = (v: number): number => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of "#rgb" or "#rrggbb", from 0 (black) to 1 (white); null if not a hex color. */
export function relativeLuminance(hex: string): number | null {
  const ch = channels(hex);
  if (!ch) return null;
  return 0.2126 * linear(ch[0]) + 0.7152 * linear(ch[1]) + 0.0722 * linear(ch[2]);
}

/** WCAG contrast ratio of two hex colors, from 1 to 21; null if either is not a hex color. */
export function contrastRatio(a: string, b: string): number | null {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  if (x === null || y === null) return null;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** True when both modes of the color reach CHART_MIN_CONTRAST against every background of that mode. */
export function isReadableChartColor(color: ChartColor): boolean {
  const ok = (fg: string, backgrounds: readonly string[]): boolean =>
    backgrounds.every((bg) => (contrastRatio(fg, bg) ?? 0) >= CHART_MIN_CONTRAST);
  return ok(color.light, CHART_BACKGROUNDS.light) && ok(color.dark, CHART_BACKGROUNDS.dark);
}
