/**
 * Sizes and type from the design kit. The Tailwind preset builds its classes from these, and
 * `scaleVariables()` writes the same values as CSS variables for plain-CSS packages such as the
 * editor. Change a value here and both follow.
 */

/** Corners: `rounded-sm` (checkboxes, keys, inline code), `rounded` (the rest), `rounded-full`. */
export const radii = { sm: '4px', DEFAULT: '8px', full: '9999px' } as const;

/** The 4 px grid, as in Tailwind: step n is n × 0.25rem (`p-2`, `gap-2`, `h-2` are 0.5rem). */
export const spacingSteps = [
  0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48,
  52, 56, 60, 64, 72, 80, 96,
] as const;

export const spacing: Readonly<Record<string, string>> = {
  px: '1px',
  ...Object.fromEntries(spacingSteps.map((step) => [String(step), `${step / 4}rem`])),
};

export const fontWeights = { normal: '400', medium: '500', semibold: '600', bold: '700' } as const;

export interface TypeStyle {
  readonly size: string;
  readonly leading: string;
  readonly weight?: string;
  readonly tracking?: string;
}

export type TypeName = 'title' | 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'label';

/** `text-title` (page title), `text-h1` to `text-h3` (headings in pages), body, small, label. */
export const typeScale: Readonly<Record<TypeName, TypeStyle>> = {
  title: { size: '2.25rem', leading: '2.75rem', weight: fontWeights.bold, tracking: '-0.01em' },
  h1: { size: '1.875rem', leading: '1.3', weight: fontWeights.semibold },
  h2: { size: '1.5rem', leading: '1.3', weight: fontWeights.semibold },
  h3: { size: '1.25rem', leading: '1.3', weight: fontWeights.semibold },
  body: { size: '1rem', leading: '1.5rem' },
  small: { size: '0.875rem', leading: '1.25rem' },
  label: { size: '0.75rem', leading: '1rem' },
};

export const fontStacks = {
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
  mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', '"Liberation Mono"', 'monospace'],
} as const;

export const shadows = {
  menu: '0 4px 16px rgb(0 0 0 / 0.08), 0 1px 3px rgb(0 0 0 / 0.06)',
  dialog: '0 16px 48px rgb(0 0 0 / 0.16), 0 2px 8px rgb(0 0 0 / 0.08)',
} as const;

/** `max-w-page` (the reading column), `w-sidebar`, `max-w-dialog`, `max-w-toast`. */
export const widths = { page: '48rem', sidebar: '16rem', dialog: '32rem', toast: '24rem' } as const;

/** `outline-offset-inset`: a focus outline drawn inside rows that sit in a scrolling list. */
export const outlineOffsets = { inset: '-2px' } as const;

/** `z-toast`: toasts stay above dialogs and menus (`z-50`). */
export const layers = { toast: '100' } as const;

/** `md:` starts at 768px, as in Tailwind. Narrower is the phone layout (the sidebar slides in). */
export const breakpoints = { md: '768px' } as const;

/**
 * The CSS variables (`--ch-space-2`, `--ch-radius`, `--ch-text-small` ...), with the same values
 * as the Tailwind classes. Step 1.5 is written `--ch-space-1_5`.
 */
export function scaleVariables(): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [name, value] of Object.entries(radii)) {
    variables[name === 'DEFAULT' ? '--ch-radius' : `--ch-radius-${name}`] = value;
  }
  for (const [step, value] of Object.entries(spacing)) {
    variables[`--ch-space-${step.replace('.', '_')}`] = value;
  }
  for (const [name, style] of Object.entries(typeScale)) {
    variables[`--ch-text-${name}`] = style.size;
    variables[`--ch-leading-${name}`] = style.leading;
    if (style.weight) variables[`--ch-weight-${name}`] = style.weight;
    if (style.tracking) variables[`--ch-tracking-${name}`] = style.tracking;
  }
  for (const [name, value] of Object.entries(fontWeights)) {
    variables[`--ch-weight-${name}`] = value;
  }
  for (const [name, stack] of Object.entries(fontStacks)) {
    variables[`--ch-font-${name}`] = stack.join(', ');
  }
  for (const [name, value] of Object.entries(shadows)) {
    variables[`--ch-shadow-${name}`] = value;
  }
  for (const [name, value] of Object.entries(widths)) variables[`--ch-${name}-width`] = value;
  return variables;
}
