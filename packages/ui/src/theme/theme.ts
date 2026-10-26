import { createContext, useContext } from 'react';

/** What the person picked. 'system' follows the device's light or dark setting. */
export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'carehub:theme';
export const DARK_QUERY = '(prefers-color-scheme: dark)';

export interface ThemeContextValue {
  theme: Theme;
  /** The theme on screen now, with 'system' worked out. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return value;
}

/** The `dark` class on <html> switches every colour variable. */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

/**
 * Put this in a <script> at the top of index.html <head>: it applies the saved theme
 * before the first paint, so dark mode doesn't flash white on load.
 */
export const themeScript = `(function(){try{var t=window.localStorage.getItem('${THEME_STORAGE_KEY}');var d=t==='dark'||(t!=='light'&&window.matchMedia('${DARK_QUERY}').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light'}catch(e){}})();`;
