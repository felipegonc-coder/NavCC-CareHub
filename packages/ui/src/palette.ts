import { hexToChannels } from './tokens';

/**
 * Picked colours for select options, text and block colours and page icons. Same names, in the
 * same order, as `OPTION_COLORS` in @carehub/databases.
 */
export const colorNames = [
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
] as const;

export type ColorName = (typeof colorNames)[number];

/** A text colour and a background colour. */
export interface ColorPair {
  readonly text: string;
  readonly bg: string;
}

export type ColorSet = Readonly<Record<ColorName, ColorPair>>;

/**
 * Each `text` keeps 4.5:1 or more on its own `bg`, the page, the sidebar and the fills, and normal
 * text (`fg`) keeps 4.5:1 or more on every `bg`. Checked in test/palette.test.ts.
 */
export const lightColors: ColorSet = {
  default: { text: '#262626', bg: '#ECECEC' },
  gray: { text: '#6F6C68', bg: '#F2F1F0' },
  brown: { text: '#906141', bg: '#F6EEEA' },
  orange: { text: '#AC5209', bg: '#FDEDE0' },
  yellow: { text: '#8C6807', bg: '#FCF3D9' },
  green: { text: '#2B7B53', bg: '#E8F5EE' },
  blue: { text: '#1C70AC', bg: '#E5F1FA' },
  purple: { text: '#8852B8', bg: '#F3ECF9' },
  pink: { text: '#BB367D', bg: '#FAEBF3' },
  red: { text: '#CA2C27', bg: '#FCE9E9' },
};

export const darkColors: ColorSet = {
  default: { text: '#E5E5E5', bg: '#363636' },
  gray: { text: '#9B9994', bg: '#2D2C2A' },
  brown: { text: '#B79178', bg: '#392C22' },
  orange: { text: '#E77F29', bg: '#432C19' },
  yellow: { text: '#C79816', bg: '#3F3418' },
  green: { text: '#49AB7A', bg: '#1D3529' },
  blue: { text: '#4BA2DF', bg: '#1D3444' },
  purple: { text: '#B287D7', bg: '#372546' },
  pink: { text: '#D97BAD', bg: '#432334' },
  red: { text: '#E77874', bg: '#47201F' },
};

export function isColorName(value: string): value is ColorName {
  return (colorNames as readonly string[]).includes(value);
}

/** CSS custom properties (`--ch-<name>-text`, `--ch-<name>-bg`) for one theme. */
export function colorVariables(colors: ColorSet): Record<string, string> {
  return Object.fromEntries(
    colorNames.flatMap((name) => [
      [`--ch-${name}-text`, hexToChannels(colors[name].text)],
      [`--ch-${name}-bg`, hexToChannels(colors[name].bg)],
    ]),
  );
}

/**
 * Tailwind classes for each colour, written out in full: Tailwind only keeps classes it can find in
 * the source, so never build them from strings.
 */
export const colorClasses: Readonly<Record<ColorName, ColorPair>> = {
  default: { text: 'text-default-text', bg: 'bg-default-bg' },
  gray: { text: 'text-gray-text', bg: 'bg-gray-bg' },
  brown: { text: 'text-brown-text', bg: 'bg-brown-bg' },
  orange: { text: 'text-orange-text', bg: 'bg-orange-bg' },
  yellow: { text: 'text-yellow-text', bg: 'bg-yellow-bg' },
  green: { text: 'text-green-text', bg: 'bg-green-bg' },
  blue: { text: 'text-blue-text', bg: 'bg-blue-bg' },
  purple: { text: 'text-purple-text', bg: 'bg-purple-bg' },
  pink: { text: 'text-pink-text', bg: 'bg-pink-bg' },
  red: { text: 'text-red-text', bg: 'bg-red-bg' },
};

/** Preset page covers (`cover: { type: 'preset', name }`). The same in both themes. */
export const coverNames = [
  'sunrise',
  'ocean',
  'meadow',
  'lavender',
  'dusk',
  'sand',
  'rose',
  'slate',
] as const;

export type CoverName = (typeof coverNames)[number];

/** CSS gradients for `style={{ backgroundImage: coverGradients[name] }}`. Decoration: no text on them. */
export const coverGradients: Readonly<Record<CoverName, string>> = {
  sunrise: 'linear-gradient(135deg, #FFCF99, #F2725F)',
  ocean: 'linear-gradient(135deg, #97DFF7, #2B60CA)',
  meadow: 'linear-gradient(135deg, #C7EBAD, #33996F)',
  lavender: 'linear-gradient(135deg, #D3C5FC, #9C64C4)',
  dusk: 'linear-gradient(135deg, #262F59, #A659A6)',
  sand: 'linear-gradient(135deg, #F6E8CB, #CF9B6E)',
  rose: 'linear-gradient(135deg, #FCC5D3, #D4547E)',
  slate: 'linear-gradient(135deg, #DFE4EC, #68778D)',
};

export function isCoverName(value: string): value is CoverName {
  return (coverNames as readonly string[]).includes(value);
}
