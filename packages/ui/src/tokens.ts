/**
 * Colour tokens from docs/plan/look-and-feel.md. Hex here; the Tailwind preset
 * turns them into CSS variables holding RGB channels ("10 10 10"), so opacity
 * modifiers such as `bg-fg/10` work.
 */
export const tokenNames = [
  'bg',
  'fg',
  'muted',
  'faint',
  'border',
  'border-hover',
  'sidebar',
  'fill',
  'fill-hover',
  'primary',
  'primary-fg',
  'primary-hover',
  'danger',
  'success',
  'warning',
  'ring',
  'overlay',
  'brand',
  'brand-fg',
] as const;

export type TokenName = (typeof tokenNames)[number];
export type TokenSet = Readonly<Record<TokenName, string>>;

export const lightTokens: TokenSet = {
  bg: '#FFFFFF',
  fg: '#0A0A0A',
  // Spec grey #737373 drops to 4.35:1 on the hover fill; #707070 keeps 4.5:1 everywhere.
  muted: '#707070',
  // Placeholders and disabled text only (2.5:1, not for normal text).
  faint: '#A3A3A3',
  border: '#E5E5E5',
  'border-hover': '#D4D4D4',
  sidebar: '#FAFAFA',
  fill: '#FAFAFA',
  'fill-hover': '#F5F5F5',
  primary: '#171717',
  'primary-fg': '#FFFFFF',
  'primary-hover': '#404040',
  danger: '#B91C1C',
  success: '#15803D',
  warning: '#B45309',
  ring: '#2563EB',
  // Behind dialogs and sheets, as `bg-overlay/50`.
  overlay: '#000000',
  // The logo: the same in both themes.
  brand: '#191919',
  'brand-fg': '#FFFFFF',
};

export const darkTokens: TokenSet = {
  bg: '#0A0A0A',
  fg: '#FAFAFA',
  muted: '#A3A3A3',
  faint: '#737373',
  border: '#262626',
  'border-hover': '#404040',
  sidebar: '#18181B',
  fill: '#262626',
  'fill-hover': '#303030',
  primary: '#FAFAFA',
  'primary-fg': '#171717',
  'primary-hover': '#E5E5E5',
  danger: '#F87171',
  success: '#4ADE80',
  warning: '#FBBF24',
  ring: '#60A5FA',
  overlay: '#000000',
  brand: '#191919',
  'brand-fg': '#FFFFFF',
};

/** '#0A0A0A' -> '10 10 10' */
export function hexToChannels(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return [16, 8, 0].map((shift) => (value >> shift) & 255).join(' ');
}

/** CSS custom properties (`--ch-<name>`) for one theme. */
export function cssVariables(tokens: TokenSet): Record<string, string> {
  return Object.fromEntries(
    tokenNames.map((name) => [`--ch-${name}`, hexToChannels(tokens[name])]),
  );
}
