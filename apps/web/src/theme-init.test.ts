import { DARK_QUERY, THEME_STORAGE_KEY } from '@carehub/ui';
import { afterEach, describe, expect, it } from 'vitest';
import initScript from '../public/theme-init.js?raw';

const html = document.documentElement;

/** Run public/theme-init.js the way the browser does, on a device with or without dark mode. */
function run(deviceDark: boolean) {
  window.matchMedia = (query: string) =>
    ({ media: query, matches: query === DARK_QUERY && deviceDark }) as MediaQueryList;
  globalThis.eval(initScript);
}

describe('theme-init.js', () => {
  afterEach(() => {
    window.localStorage.clear();
    html.className = '';
    html.removeAttribute('style');
  });

  it('reads the same key and media query as @carehub/ui', () => {
    expect(initScript).toContain(`'${THEME_STORAGE_KEY}'`);
    expect(initScript).toContain(`'${DARK_QUERY}'`);
  });

  it('follows the device when nothing is saved', () => {
    run(true);
    expect(html).toHaveClass('dark');
    expect(html.style.colorScheme).toBe('dark');
  });

  it('applies the saved choice before React loads', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    run(true);
    expect(html).not.toHaveClass('dark');
    expect(html.style.colorScheme).toBe('light');

    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    run(false);
    expect(html).toHaveClass('dark');
  });
});
