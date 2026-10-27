/**
 * Chart colours as design-kit colour names (packages/ui palette.ts uses the same names as
 * OPTION_COLORS). Every colour comes from the kit, so there is no hex here and the kit's own tests
 * check contrast. The UI looks the name up in the kit (its `--ch-<name>-…` variables take an
 * alpha) and turns the strength into that alpha.
 */
import type { ChartOptions, OptionColor } from './types';

/** 1 (faintest) to 5 (solid). The UI uses it as the alpha on the kit colour. */
export type ChartStrength = 1 | 2 | 3 | 4 | 5;

/** The colour of a bar, line, slice or legend entry. Solid when there is no strength. */
export interface ChartColor {
  color: OptionColor;
  strength?: ChartStrength;
}

export type ChartPalette = NonNullable<ChartOptions['palette']>;

/** In the order the palette picker lists them. "default" shows as Auto. */
export const CHART_PALETTES = [
  'default',
  'colorful',
  'colorblind',
  'mono',
] as const satisfies readonly ChartPalette[];

const solid = (color: OptionColor): ChartColor => ({ color });
const faded = (color: OptionColor, strength: ChartStrength): ChartColor => ({ color, strength });

// Ordered so neighbours differ clearly. Gray and default are kept for "Other" and "No value".
const HUES: readonly OptionColor[] = [
  'blue',
  'orange',
  'green',
  'purple',
  'pink',
  'yellow',
  'red',
  'brown',
];
const MIXED: readonly ChartColor[] = [...HUES.map(solid), ...HUES.map((h) => faded(h, 3))];

const SEQUENCES: Readonly<Record<ChartPalette, readonly ChartColor[]>> = {
  // Auto: categories and series that are options keep their own colour; the rest take these.
  default: MIXED,
  // Colorful: these colours in turn for everything, options included.
  colorful: MIXED,
  // Neighbours always differ along the blue–yellow axis, which the common kinds of colour
  // blindness keep, or in strength.
  colorblind: [
    solid('blue'),
    solid('orange'),
    faded('blue', 3),
    faded('orange', 3),
    solid('purple'),
    solid('yellow'),
    faded('purple', 3),
    faded('yellow', 3),
  ],
  // One hue. Neighbours differ by at least 2 steps of strength.
  mono: [solid('blue'), faded('blue', 3), faded('blue', 1), faded('blue', 4), faded('blue', 2)],
};

/** "Other": everything past the category or split limit. */
export const OTHER_COLOR: ChartColor = { color: 'gray' };
/** "No value". Fainter than an option coloured "default". */
export const EMPTY_COLOR: ChartColor = { color: 'default', strength: 2 };

function isPalette(p: unknown): p is ChartPalette {
  return typeof p === 'string' && (CHART_PALETTES as readonly string[]).includes(p);
}

/** The colour sequence of a palette. An unknown palette gives Auto's. */
export function paletteColors(palette: ChartPalette | undefined): readonly ChartColor[] {
  return SEQUENCES[isPalette(palette) ? palette : 'default'];
}

/** The colour for the nth category or series. The sequence repeats when it runs out. */
export function paletteColor(palette: ChartPalette | undefined, index: number): ChartColor {
  const colors = paletteColors(palette);
  const i = Number.isFinite(index) ? Math.trunc(index) : 0;
  const n = colors.length;
  return { ...(colors[((i % n) + n) % n] ?? OTHER_COLOR) };
}
