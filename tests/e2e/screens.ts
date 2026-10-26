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

export const screens: Screen[] = [{ name: 'home', path: '/' }];
