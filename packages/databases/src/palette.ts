/**
 * The option color palette as data (Databases spec v2, 3.3, 3.4 and 3.14): for each of the 10
 * option colors, in light and dark mode, the chip, the board column, the row and cell tints of
 * conditional color, and the chart color. Colors are "#RRGGBB".
 *
 * Readable by construction, and checked by the tests: chip text reaches 4.5:1 on its chip, and the
 * theme's text and muted text reach 4.5:1 on the page and on every column, row and cell tint
 * (WCAG 2 contrast for normal text). Chart colors reach 3:1 against the page, so bars, lines and
 * slices stand out (WCAG non-text contrast).
 */
import { OPTION_COLORS, type OptionColor } from './types';

export const THEMES = ['light', 'dark'] as const;
/** Light or dark mode. */
export type Theme = (typeof THEMES)[number];

/** Text contrast the palette keeps everywhere (WCAG AA, normal text). */
export const MIN_TEXT_CONTRAST = 4.5;
/** Contrast of chart colors against the page (WCAG AA, graphics). */
export const MIN_CHART_CONTRAST = 3;

/** One option color in one theme. */
export interface Swatch {
  /** Background of the option's chip (Select, Multi-select and Status values). */
  chip: string;
  /** Text on the chip. */
  chipText: string;
  /** A board column's background when "Color columns" is on. */
  column: string;
  /** Conditional color on a whole row (a card, calendar item or timeline bar in other layouts). */
  row: string;
  /** Conditional color on one cell: a little stronger than the row tint, so it shows on a row. */
  cell: string;
  /** Bars, lines, points and slices in charts. */
  chart: string;
}

/** The page, and the text drawn on columns, rows and cells: what the tints are checked against. */
export interface ThemeColors {
  background: string;
  text: string;
  /** Secondary text: counts, "Untitled", placeholders. */
  mutedText: string;
}

export const THEME_COLORS: Readonly<Record<Theme, ThemeColors>> = {
  light: { background: '#FFFFFF', text: '#2C2B28', mutedText: '#5F5E59' },
  dark: { background: '#191919', text: '#E8E7E4', mutedText: '#A6A49F' },
};

type SwatchRow = readonly [string, string, string, string, string, string];

// Each row: chip, chipText, column, row, cell, chart.
const LIGHT: Record<OptionColor, SwatchRow> = {
  default: ['#E9E9E7', '#514E48', '#F7F6F6', '#F2F1F0', '#E8E7E5', '#878278'],
  gray: ['#E6E8EA', '#464C53', '#F5F6F7', '#F0F1F2', '#E5E7E9', '#757F8A'],
  brown: ['#EDE4DE', '#6B462E', '#F9F6F3', '#F5F0ED', '#EEE5E0', '#B97446'],
  orange: ['#FAE4D1', '#914808', '#FDF6EF', '#FCF0E6', '#FAE5D3', '#DB6906'],
  yellow: ['#FBF0D0', '#866603', '#FEFAEE', '#FDF7E5', '#FBF1D2', '#AD8200'],
  green: ['#DCEFE5', '#28714A', '#F3F9F6', '#ECF6F1', '#DEF0E6', '#309C62'],
  blue: ['#D6E8F5', '#155484', '#F1F7FC', '#E8F2FA', '#D8E9F6', '#1D8DE2'],
  purple: ['#E6DAF1', '#4C2277', '#F6F2FA', '#F1EBF7', '#E7DCF2', '#7F33CC'],
  pink: ['#F4D7E8', '#7E1B55', '#FBF1F7', '#F9E9F2', '#F4D9E9', '#D9268E'],
  red: ['#F6D7D5', '#861B13', '#FCF1F0', '#FAE9E8', '#F7D9D7', '#E62719'],
};
const DARK: Record<OptionColor, SwatchRow> = {
  default: ['#4A4845', '#C9C8C5', '#21201F', '#262523', '#31302D', '#918E88'],
  gray: ['#43474C', '#C4C7CA', '#1E2022', '#232527', '#2C2F32', '#858C93'],
  brown: ['#513F34', '#E1C2AD', '#271E19', '#2D231D', '#3A2D25', '#BC835C'],
  orange: ['#67401E', '#F4C49A', '#311F0E', '#392411', '#492D15', '#E28736'],
  yellow: ['#67551E', '#F4DD9A', '#31290E', '#392F11', '#443814', '#E2B736'],
  green: ['#2E5641', '#A8E6C5', '#16291F', '#1A3024', '#213D2E', '#53C688'],
  blue: ['#244660', '#A0CCEE', '#12222E', '#142736', '#1A3244', '#4296D7'],
  purple: ['#422B5A', '#C7A5E9', '#20152B', '#251832', '#2F1F40', '#8F51CD'],
  pink: ['#5D2847', '#EBA2CD', '#2D1322', '#341627', '#421C32', '#D14798'],
  red: ['#602824', '#EEA5A0', '#2E1312', '#361714', '#441D1A', '#D74C42'],
};

const swatchOf = ([chip, chipText, column, row, cell, chart]: SwatchRow): Swatch => ({
  chip,
  chipText,
  column,
  row,
  cell,
  chart,
});

/** Option color → theme → its swatch: OPTION_PALETTE.blue.dark.chip. */
export const OPTION_PALETTE = Object.fromEntries(
  OPTION_COLORS.map((c) => [c, { light: swatchOf(LIGHT[c]), dark: swatchOf(DARK[c]) }]),
) as Readonly<Record<OptionColor, Readonly<Record<Theme, Swatch>>>>;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** One sRGB channel (0–255) as linear light, as WCAG 2 defines it. */
function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance of "#RGB" or "#RRGGBB" (any case): 0 for black to 1 for white. */
export function relativeLuminance(color: string): number {
  const digits = HEX.exec(color)?.[1];
  if (digits === undefined) throw new Error(`Not a color: "${color}"`);
  const full = digits.length === 3 ? digits.replace(/./g, '$&$&') : digits;
  const [r, g, b] = [0, 2, 4].map((i) => linear(parseInt(full.slice(i, i + 2), 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** WCAG 2 contrast ratio of two colors: 1 (the same) to 21 (black and white), in either order. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
