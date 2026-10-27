import { expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import { makeDatabase } from '../databases/database-api.js';
import { DatabaseScreen } from '../databases/database-page.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, literally, openAs } from '../pages/page-screen.js';
import { SearchWindow, linkEditor, uniqueWord, type SearchKeys } from './search-window.js';

// Search, sections 2, 3.2, 3.4 and 6: the search window, matching while typing, and the recent
// lists it shows before typing.

const SHORTCUTS: SearchKeys[] = ['ControlOrMeta+K', 'ControlOrMeta+P'];

test.describe('Search: opening it from every screen', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'home', 'pages', 'editor', 'databases', 'search');

  test('SR-01 Ctrl+K and Ctrl+P open search on Home, in a database and on a page; with text selected in the editor, Ctrl+K opens the link editor', async ({
    page,
  }) => {
    const word = uniqueWord();
    await signInAs(page, 'editor');
    const database = await makeDatabase(page);
    const pageId = await makePage(page, `Fictional QA shortcuts ${word}`);
    const search = new SearchWindow(page);
    const screen = new PageScreen(page);

    const pressBoth = async () => {
      for (const keys of SHORTCUTS) {
        await search.openWith(keys);
        await search.close();
      }
    };

    await test.step('On Home', async () => {
      await page.goto('/');
      await expect(page.getByRole('main')).toBeVisible();
      await pressBoth();
    });

    await test.step('In a database', async () => {
      await new DatabaseScreen(page, database.id).open();
      await pressBoth();
    });

    const text = `Fictional QA link text ${word}`;
    await test.step('On a page, with the cursor in the text: search, and Esc puts the focus back', async () => {
      await screen.goto(pageId);
      await pressBoth();
      await screen.typeAtEnd(text);
      await search.openWith('ControlOrMeta+K');
      await search.close();
      await expect(screen.content).toBeFocused();
    });

    await test.step('With text selected in the editor, Ctrl+K opens the link editor instead', async () => {
      await screen.content.getByText(text).click();
      await page.keyboard.press('End');
      await page.keyboard.press('Shift+Home');
      await page.keyboard.press('ControlOrMeta+K');
      await expect(linkEditor(page)).toBeVisible();
      await expect(search.dialog).toBeHidden();
    });
  });
});

test.describe('Search: matching and the recent lists', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'search');

  test('SR-03 "ref" finds "Refund steps" while typing, "refunds" finds refund, "goncalves" finds Gonçalves, and case doesn\'t matter', async ({
    page,
  }) => {
    const word = uniqueWord();
    const refund = `Fictional QA Refund steps ${word}`;
    const person = `Fictional QA Rita Gonçalves ${word}`;
    await signInAs(page, 'editor');
    await makePage(page, refund);
    await makePage(page, person);
    const search = new SearchWindow(page);
    await page.goto('/');
    await search.openWith();
    await search.waitUntilFound(`${word} steps`, refund);
    await search.waitUntilFound(`${word} rita`, person);
    await search.searchFor('');

    await test.step('"ref" finds "Refund steps" while typing, before Enter', async () => {
      await search.type(`${word} ref`);
      await expect(search.result(refund)).toBeVisible();
      await expect(search.result(person)).toHaveCount(0);
      await expect(search.results.first()).toHaveAttribute('aria-selected', 'true');
    });

    await test.step('"refunds" finds "Refund": English word forms match', async () => {
      await search.searchFor(`${word} refunds`);
      await expect(search.result(refund)).toBeVisible();
      await expect(search.result(person)).toHaveCount(0);
    });

    await test.step('"goncalves" finds "Gonçalves": accents don\'t matter', async () => {
      await search.searchFor(`${word} goncalves`);
      await expect(search.result(person)).toBeVisible();
      await expect(search.result(refund)).toHaveCount(0);
    });

    await test.step("Case doesn't matter", async () => {
      await search.searchFor(`${word.toUpperCase()} GONCALVES`);
      await expect(search.result(person)).toBeVisible();
      await search.searchFor(`${word.toUpperCase()} REFUND STEPS`);
      await expect(search.result(refund)).toBeVisible();
      await expect(search.result(person)).toHaveCount(0);
    });
  });

  test('SR-02 before typing, the last 8 opened pages and the last 5 searches show, and Clear empties the recent searches', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const word = uniqueWord();
    const numbers = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    const titleOf = (number: string) => `Fictional QA Recent ${number} ${word}`;
    const ids = new Map<string, string>();

    await test.step('Eli makes nine pages in the team space, which Val can open', async () => {
      const eli = await openAs(browser, 'editor');
      const parentId = await makePage(eli.page, `Fictional QA recent lists ${word}`);
      for (const number of numbers) {
        ids.set(number, await makePage(eli.page, titleOf(number), { parentId }));
      }
      await eli.close();
    });

    // Val, so that the lists are about this test: each person has their own (section 3.4).
    await signInAs(page, 'viewer');
    const search = new SearchWindow(page);
    const screen = new PageScreen(page);
    const searches = numbers.slice(0, 6).map((number) => `${word} ${number}`);

    await test.step('Val searches six times, opening a result with Enter each time', async () => {
      await page.goto('/');
      for (const [index, text] of searches.entries()) {
        await search.openWith();
        await search.waitUntilFound(text, titleOf(numbers[index]!));
        await page.keyboard.press('Enter');
        await expect(search.dialog).toBeHidden();
        await expect(page).toHaveURL(new RegExp(`/p/${ids.get(numbers[index]!)}`));
      }
    });

    await test.step('Val opens the nine pages, one to nine', async () => {
      for (const number of numbers) await screen.goto(ids.get(number)!);
    });

    await test.step('Before typing: the last 8 pages, newest first, and the last 5 searches', async () => {
      const recent = search.section('Recent');
      const recentSearches = search.section('Recent searches');
      await expect(async () => {
        await search.openWith();
        try {
          await expect(recent.getByRole('option')).toHaveCount(8, {
            timeout: 2_000,
          });
          await expect(recent.getByRole('option').first()).toHaveAccessibleName(
            literally(titleOf('nine')),
          );
          for (const number of numbers.slice(1)) {
            await expect(
              recent.getByRole('option', { name: literally(titleOf(number)) }),
            ).toBeVisible();
          }
          await expect(recent.getByRole('option', { name: literally(titleOf('one')) })).toHaveCount(
            0,
          );
          await expect(recentSearches.getByRole('option')).toHaveCount(5);
          await expect(recentSearches.getByRole('option').first()).toHaveAccessibleName(
            literally(searches[5]!),
          );
          for (const text of searches.slice(1)) {
            await expect(recentSearches.getByText(text, { exact: true })).toBeVisible();
          }
          await expect(recentSearches.getByText(searches[0]!, { exact: true })).toHaveCount(0);
        } finally {
          if (await search.dialog.isVisible()) await search.close();
        }
      }).toPass({ timeout: 20_000 });
    });

    await test.step('Clear empties the recent searches, and they stay empty', async () => {
      await search.openWith();
      await search
        .section('Recent searches')
        .getByRole('button', { name: 'Clear', exact: true })
        .click();
      await expect(search.section('Recent searches').getByRole('option')).toHaveCount(0);
      await expect(search.section('Recent').getByRole('option')).toHaveCount(8);
      await search.close();
      await page.reload();
      await expect(screen.title).toBeVisible();
      await search.openWith();
      await expect(search.section('Recent searches').getByRole('option')).toHaveCount(0);
      await expect(search.section('Recent').getByRole('option')).toHaveCount(8);
    });
  });
});
