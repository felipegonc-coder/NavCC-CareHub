import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import { colorNames, colorVariables, darkColors, lightColors } from './src/palette';
import {
  breakpoints,
  fontStacks,
  fontWeights,
  layers,
  outlineOffsets,
  radii,
  scaleVariables,
  shadows,
  spacing,
  typeScale,
  widths,
} from './src/scale';
import { cssVariables, darkTokens, lightTokens, tokenNames } from './src/tokens';

const colors = Object.fromEntries([
  ...tokenNames.map((name) => [name, `rgb(var(--ch-${name}) / <alpha-value>)`]),
  // Picked colours: `text-blue-text`, `bg-blue-bg` ...
  ...colorNames.flatMap((name) =>
    ['text', 'bg'].map((part) => [
      `${name}-${part}`,
      `rgb(var(--ch-${name}-${part}) / <alpha-value>)`,
    ]),
  ),
]);

type FontSize = [
  size: string,
  options: { lineHeight: string; fontWeight?: string; letterSpacing?: string },
];

const fontSize: Record<string, FontSize> = {};
for (const [name, style] of Object.entries(typeScale)) {
  const options: FontSize[1] = { lineHeight: style.leading };
  if (style.weight) options.fontWeight = style.weight;
  if (style.tracking) options.letterSpacing = style.tracking;
  fontSize[name] = [style.size, options];
}

/**
 * Care Hub Tailwind preset: colour tokens, picked colours, sizes and type from src/scale.ts, and
 * all of them as CSS variables for plain CSS.
 */
const preset = {
  content: [],
  darkMode: 'class',
  theme: {
    extend: {
      screens: { md: breakpoints.md },
      colors,
      borderColor: { DEFAULT: 'rgb(var(--ch-border))' },
      borderRadius: { ...radii },
      spacing: { ...spacing, sidebar: widths.sidebar },
      maxWidth: { page: widths.page, dialog: widths.dialog, toast: widths.toast },
      fontFamily: { sans: [...fontStacks.sans], mono: [...fontStacks.mono] },
      fontSize,
      fontWeight: { ...fontWeights },
      boxShadow: { ...shadows },
      outlineOffset: { ...outlineOffsets },
      zIndex: { ...layers },
      keyframes: {
        'ch-fade-in': { from: { opacity: '0' } },
        'ch-pop-in': { from: { opacity: '0', scale: '0.97' } },
        'ch-slide-in-left': { from: { translate: '-100% 0' } },
      },
      animation: {
        'fade-in': 'ch-fade-in 150ms ease-out',
        'pop-in': 'ch-pop-in 150ms ease-out',
        'slide-in-left': 'ch-slide-in-left 200ms ease-out',
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ':root': {
          ...cssVariables(lightTokens),
          ...colorVariables(lightColors),
          ...scaleVariables(),
        },
        '.dark': { ...cssVariables(darkTokens), ...colorVariables(darkColors) },
      });
    }),
  ],
} satisfies Config;

export default preset;
