import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import { cssVariables, darkTokens, lightTokens, tokenNames } from './src/tokens';

const colors = Object.fromEntries(
  tokenNames.map((name) => [name, `rgb(var(--ch-${name}) / <alpha-value>)`]),
);

/** Care Hub Tailwind preset: colour tokens, system font, type scale, 8 px corners. */
const preset = {
  content: [],
  darkMode: 'class',
  theme: {
    extend: {
      colors,
      borderColor: { DEFAULT: 'rgb(var(--ch-border))' },
      borderRadius: { DEFAULT: '8px' },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'system-ui',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          'monospace',
        ],
      },
      fontSize: {
        title: ['2.25rem', { lineHeight: '2.75rem', fontWeight: '700', letterSpacing: '-0.01em' }],
        body: ['1rem', { lineHeight: '1.5rem' }],
        small: ['0.875rem', { lineHeight: '1.25rem' }],
        label: ['0.75rem', { lineHeight: '1rem' }],
      },
      maxWidth: { page: '48rem' },
      spacing: { sidebar: '16rem' },
      boxShadow: {
        menu: '0 4px 16px rgb(0 0 0 / 0.08), 0 1px 3px rgb(0 0 0 / 0.06)',
        dialog: '0 16px 48px rgb(0 0 0 / 0.16), 0 2px 8px rgb(0 0 0 / 0.08)',
      },
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
      addBase({ ':root': cssVariables(lightTokens), '.dark': cssVariables(darkTokens) });
    }),
  ],
} satisfies Config;

export default preset;
