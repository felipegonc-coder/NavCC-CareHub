import type { Page } from '@playwright/test';

/**
 * A screen the browser tests open. Each one is checked on desktop and phone, in light and dark
 * mode, and gets four screenshots. See README.md for how to add one.
 */
export interface Screen {
  /** Unique and kebab-case: used in test titles and screenshot names (home-phone-dark.png). */
  name: string;
  /** Where the screen is, relative to the base URL. */
  path: string;
  /** Runs after `path` has loaded and before the checks: sign in, open a dialog, fill a form. */
  setup?: (page: Page) => Promise<void>;
}

// The core screens, then one line per lane. Each lane lists its screens in its own file,
// <lane>/screens.ts (see README.md), so parallel pull requests never edit the same lines.
export const screens: Screen[] = [
  { name: 'home', path: '/' },
  {
    name: 'shell-menu',
    path: '/',
    // Phones: the sidebar's slide-in menu, open. Computers have no menu button; they show the skip
    // link, which the first Tab reveals.
    setup: async (page) => {
      if ((page.viewportSize()?.width ?? 0) < 768) {
        await page.getByRole('button', { name: 'Open menu' }).click();
        await page.getByRole('dialog', { name: 'Menu' }).waitFor();
      } else {
        await page.getByRole('banner').waitFor();
        await page.keyboard.press('Tab');
      }
    },
  },
  { name: 'not-found', path: '/no-such-screen' },
  { name: 'design', path: '/design' },
  { name: 'sign-in', path: '/sign-in' },

  ...(await import('./learning/screens.js')).screens, // feature: learning

  ...(await import('./databases/screens.js')).screens, // feature: databases

  ...(await import('./forms/screens.js')).screens, // feature: forms

  ...(await import('./team/screens.js')).screens, // feature: team

  ...(await import('./extras/screens.js')).screens, // feature: extras
];
