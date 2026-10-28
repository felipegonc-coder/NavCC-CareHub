import type { Page } from '@playwright/test';
import type { Screen } from '../screens.js';

/** Ctrl+K opens the search window once the shell is there (Search, section 6). */
async function openSearch(page: Page) {
  await page.locator('main').waitFor();
  await page.keyboard.press('ControlOrMeta+K');
  await page.getByRole('dialog', { name: 'Search' }).getByRole('combobox').waitFor();
}

// The Extras lane's screens (docs/extras/README.md): search, history, templates, import and export,
// the knowledge base and Claude. Names start with `extras-`.
export const screens: Screen[] = [
  // Search (docs/extras/testing.md): the window before typing, and after a search.
  { name: 'extras-search', path: '/', setup: openSearch },
  {
    name: 'extras-search-results',
    path: '/',
    setup: async (page) => {
      await openSearch(page);
      const dialog = page.getByRole('dialog', { name: 'Search' });
      await dialog.getByRole('combobox').fill('Fictional refund steps');
      // Results, "No results for …", or (signed out) "Search isn't working right now."
      await dialog
        .getByRole('option')
        .or(dialog.getByText(/^No results for|^Search isn't working/))
        .first()
        .waitFor();
    },
  },
];
