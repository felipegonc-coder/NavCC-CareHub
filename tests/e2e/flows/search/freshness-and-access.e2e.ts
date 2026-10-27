import type { Page } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, openAs } from '../pages/page-screen.js';
import { AccessDialog } from '../sharing/access.js';
import { choice, nameOf } from '../sharing/share-dialog.js';
import { SearchWindow, uniqueWord } from './search-window.js';

// Search, section 3.3: renames and edits are found within seconds, Trash and lost access take
// pages out of the results at once, and nobody finds a page they can't open.

/** Searches until a page shows, within `ms`: the spec's freshness times, plus a second for the screen. */
async function foundWithin(search: SearchWindow, text: string, title: string, ms: number) {
  await expect(async () => {
    await search.searchFor('');
    await search.searchFor(text);
    await expect(search.titled(title)).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: ms + 1_000, intervals: [250] });
}

/** Searches once: `shown` is found, and `gone` isn't (the search answers both together). */
async function foundWithout(search: SearchWindow, text: string, shown: string, gone: string) {
  await search.searchFor('');
  await search.searchFor(text);
  await expect(search.titled(shown)).toBeVisible();
  await expect(search.titled(gone)).toHaveCount(0);
}

/** Page menu → Move to Trash. */
async function moveToTrash(page: Page, id: string) {
  const screen = new PageScreen(page);
  await screen.goto(id);
  const menu = await screen.openPageMenu();
  await menu.getByRole('menuitem', { name: /^move to trash/i }).click();
  await expect(page.getByText(/^Moved to Trash/).first()).toBeVisible();
}

test.describe('Search: fresh results', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'search', 'trashHistory');

  test('SR-09 a renamed page is found by its new name within 2 seconds and an edit within 5; a page moved to Trash is gone at once', async ({
    page,
  }) => {
    const word = uniqueWord();
    const renamed = `Fictional QA ${word} to rename`;
    const trashed = `Fictional QA ${word} to trash`;
    await signInAs(page, 'editor');
    const renamedId = await makePage(page, renamed);
    const trashedId = await makePage(page, trashed);
    const screen = new PageScreen(page);
    const search = new SearchWindow(page);
    await search.openWith();
    await search.waitUntilFound(word, trashed);
    await search.close();

    await test.step('Rename: the new name is found within 2 seconds', async () => {
      const newWord = uniqueWord();
      await screen.goto(renamedId);
      await screen.title.click();
      await page.keyboard.press('End');
      await page.keyboard.type(` ${newWord}`);
      await screen.expectTitle(`${renamed} ${newWord}`);
      await search.openWith();
      await foundWithin(search, newWord, renamed, 2_000);
      await search.close();
    });

    await test.step('Edit: a new word in the text is found within 5 seconds', async () => {
      const typed = uniqueWord();
      await screen.typeAtEnd(`Fictional QA ${typed}`);
      await search.openWith();
      await foundWithin(search, typed, renamed, 5_000);
      await search.close();
    });

    await test.step('Move to Trash: gone from the results at once', async () => {
      await moveToTrash(page, trashedId);
      await search.openWith();
      await foundWithout(search, word, renamed, trashed);
      await search.close();
    });
  });
});

test.describe('Search: only what the person can open', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'sharing', 'search');

  test("SR-08 searching for a word from a private page Avery can't open shows no result, count or snippet from it", async ({
    page,
    browser,
  }) => {
    const word = uniqueWord();
    const secret = `Fictional QA pay band figures ${word}`;
    const payBands = `Fictional QA Pay bands ${uniqueWord()}`;
    const open = `Fictional QA open notes ${word}`;
    await signInAs(page, 'editor');
    const payBandsId = await makePage(page, payBands, { space: 'Private' });
    await makePage(page, open);
    const screen = new PageScreen(page);
    await screen.goto(payBandsId);
    await screen.typeAtEnd(secret);
    // Eli finds both, so the index has the private page's text.
    const search = new SearchWindow(page);
    await search.openWith();
    await search.waitUntilFound(word, payBands);
    await expect(search.titled(open)).toBeVisible();
    await search.close();

    const avery = await openAs(browser, 'admin');
    const theirs = new SearchWindow(avery.page);
    await test.step('Avery searches for the word: only the open page, "1 result", no snippet', async () => {
      await theirs.openWith();
      await theirs.waitUntilFound(word, open);
      await expect(theirs.titled('Fictional QA')).toHaveCount(1);
      await expect(theirs.dialog).toContainText(/\b1 result\b/);
      await expect(theirs.dialog).not.toContainText('pay band figures');
      await expect(theirs.dialog).not.toContainText(payBands);
    });

    await test.step("Avery searches for the private page's title: No results", async () => {
      await theirs.searchFor(payBands);
      await expect(theirs.noResultsFor(payBands)).toBeVisible();
      await theirs.close();
    });
    await avery.close();
  });

  test('SR-09 removing someone’s access takes the page out of their results at once', async ({
    page,
    browser,
  }) => {
    const word = uniqueWord();
    const shared = `Fictional QA shared notes ${word}`;
    const open = `Fictional QA open notes ${word}`;
    await signInAs(page, 'editor');
    const sharedId = await makePage(page, shared, { space: 'Private' });
    await makePage(page, open);
    const casey = await openAs(browser, 'commenter');
    const caseyName = await nameOf(casey.page);
    const screen = new PageScreen(page);
    const dialog = new AccessDialog(page);
    await screen.goto(sharedId);
    await dialog.open();
    await dialog.invite(caseyName, 'Can view');

    const theirs = new SearchWindow(casey.page);
    await theirs.openWith();
    await theirs.waitUntilFound(word, shared);
    await expect(theirs.titled(open)).toBeVisible();

    await test.step("Eli removes Casey; Casey's next search leaves the page out", async () => {
      await dialog.levelMenu(dialog.entry(caseyName)).click();
      await choice(page, /^remove/i).click();
      await expect(dialog.entry(caseyName)).toHaveCount(0);
      await foundWithout(theirs, word, open, shared);
    });
    await casey.close();
  });
});
