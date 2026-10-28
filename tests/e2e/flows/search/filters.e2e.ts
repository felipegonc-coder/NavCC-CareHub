import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { literally, openAs } from '../pages/page-screen.js';
import { nameOf } from '../sharing/share-dialog.js';
import { SearchWindow, uniqueWord } from './search-window.js';

// Search, sections 2 and 3.2: filter chips and sort, and what the window offers when nothing
// matches.

test.describe('Search: filters and sort', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'search');

  test('SR-06 In and Edited by filter the results on their own and together, and Edited newest or oldest first sorts them', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const word = uniqueWord();
    // The shelf's title leaves the word out, so the shelf itself is never a result.
    const shelf = uniqueName('Fictional QA search shelf');
    const first = `Fictional QA ${word} first`;
    const second = `Fictional QA ${word} second`;
    const elsewhere = `Fictional QA ${word} elsewhere`;
    const averys = `Fictional QA ${word} by Avery`;

    await signInAs(page, 'editor');
    const shelfId = await makePage(page, shelf);
    // Made one after another, so "first" was edited before "second".
    await makePage(page, first, { parentId: shelfId });
    await makePage(page, second, { parentId: shelfId });
    await makePage(page, elsewhere);
    const avery = await openAs(browser, 'admin');
    await makePage(avery.page, averys, { parentId: shelfId });
    await avery.close();
    const eli = await nameOf(page);
    const search = new SearchWindow(page);
    const results = search.titled('Fictional QA');
    const titles = (...shown: string[]) => shown.map((title) => literally(title));

    await test.step('Without filters, all four are found', async () => {
      await search.openWith();
      await search.waitUntilFound(word, averys);
      await expect(results).toHaveCount(4);
    });

    await test.step('In: the shelf keeps the three inside it', async () => {
      await search.filterBy('In', shelf);
      await expect(results).toHaveCount(3);
      await expect(search.titled(elsewhere)).toHaveCount(0);
      await search.action('Clear filters').click();
      await expect(results).toHaveCount(4);
    });

    await test.step('Edited by: Eli keeps his three', async () => {
      await search.filterBy('Edited by', eli);
      await expect(results).toHaveCount(3);
      await expect(search.titled(averys)).toHaveCount(0);
    });

    await test.step('Both together: the two of Eli inside the shelf', async () => {
      await search.filterBy('In', shelf);
      await expect(results).toHaveCount(2);
      await expect(search.titled(first)).toHaveCount(1);
      await expect(search.titled(second)).toHaveCount(1);
    });

    await test.step('Edited, newest first, then oldest first', async () => {
      await search.sortBy(/edited,? newest/i);
      await expect(results).toHaveText(titles(second, first));
      await search.sortBy(/edited,? oldest/i);
      await expect(results).toHaveText(titles(first, second));
    });
  });
});

test.describe('Search: no results', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'search', 'trashHistory');

  test('SR-11 no results offers Did you mean for a close title, Clear filters once a filter is on, and Search in Trash', async ({
    page,
  }) => {
    const word = uniqueWord();
    // One letter off: the made-up words use a to p only, so a z is always different.
    const typo = `${word.slice(0, -1)}z`;
    const title = `Fictional QA ${word}`;
    await signInAs(page, 'editor');
    await makePage(page, title);
    const search = new SearchWindow(page);
    await search.openWith();
    await search.waitUntilFound(word, title);

    await test.step('A made-up word: No results, with Search in Trash', async () => {
      const nonsense = uniqueWord();
      await search.searchFor(nonsense);
      await expect(search.noResultsFor(nonsense)).toBeVisible();
      await expect(search.action('Search in Trash')).toBeVisible();
      await expect(search.action('Clear filters')).toHaveCount(0);
    });

    await test.step('With Title only on: Clear filters too, and it turns the filter off', async () => {
      await search.chip('Title only').click();
      await expect(search.action('Clear filters')).toBeVisible();
      await search.action('Clear filters').click();
      await expect(search.action('Clear filters')).toHaveCount(0);
    });

    await test.step('One letter off a title: Did you mean, which searches for the title', async () => {
      await search.searchFor(typo);
      await expect(search.noResultsFor(typo)).toBeVisible();
      await expect(search.dialog.getByText(/Did you mean/)).toContainText(word);
      await search.action(new RegExp(word)).click();
      await expect(search.titled(title)).toBeVisible();
    });

    await test.step('Search in Trash opens Trash', async () => {
      const nonsense = uniqueWord();
      await search.searchFor(nonsense);
      await search.action('Search in Trash').click();
      await expect(page.getByRole('dialog', { name: /trash/i })).toBeVisible();
    });
  });
});
