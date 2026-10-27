import { test } from './test.js';

/** The four projects in tests/e2e/playwright.config.ts. */
export type ProjectName = 'desktop-light' | 'desktop-dark' | 'phone-light' | 'phone-dark';

/**
 * Runs the tests of the current file or `test.describe` block only in the given projects and skips
 * them in the others. Flows run in desktop-light unless a check is about the phone layout or dark
 * mode, so one flow costs one browser run instead of four.
 *
 *   onlyIn('desktop-light');
 *   onlyIn('desktop-light', 'phone-light');
 */
export function onlyIn(...projects: [ProjectName, ...ProjectName[]]): void {
  test.skip(
    ({ isMobile, colorScheme }) =>
      !projects.includes(
        `${isMobile ? 'phone' : 'desktop'}-${colorScheme === 'dark' ? 'dark' : 'light'}`,
      ),
    `Runs only in ${projects.join(', ')}`,
  );
}
