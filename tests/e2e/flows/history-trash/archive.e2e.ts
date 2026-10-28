import { expect, needs, onlyIn, shownDate, signInAs, test } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, literally } from '../pages/page-screen.js';
import { SearchWindow, uniqueWord } from '../search/search-window.js';
import { Sidebar } from '../sidebar/sidebar-page.js';
import { nameOf } from '../sharing/share-dialog.js';
import { Archive, includeArchived } from './updates-and-archive.js';

// Page history and Trash, section 3.5: an archived page and its sub-pages turn read-only and leave
// the sidebar and search (unless Include archived is on); Unarchive puts everything back.

test.describe('Archive: a page with a sub-page', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'search', 'trashHistory');

  test('HT-14 archiving makes a page and its sub-page read-only and takes them out of the sidebar and search; Unarchive brings them back', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // One made-up word in every title, so a search for it finds this test's pages only.
    const word = uniqueWord();
    const shelf = `Fictional QA archive shelf ${word}`;
    const handbook = `Fictional QA Old handbook ${word}`;
    const rota = `Fictional QA Old rota ${word}`;
    const current = `Fictional QA Current handbook ${word}`;

    await signInAs(page, 'editor');
    const shelfId = await makePage(page, shelf);
    const handbookId = await makePage(page, handbook, { parentId: shelfId });
    const rotaId = await makePage(page, rota, { parentId: handbookId });
    await makePage(page, current, { parentId: shelfId });
    const who = await nameOf(page);
    const screen = new PageScreen(page);
    const sidebar = new Sidebar(page);
    const search = new SearchWindow(page);
    const archive = new Archive(page);

    /**
     * Searches for the word until the current handbook shows, then checks the old handbook and its
     * rota: found, or left out. Searching again covers an index that is a moment behind.
     */
    const searchFinds = (old: 'found' | 'left out') =>
      expect(async () => {
        await search.searchFor('');
        await search.searchFor(word);
        await expect(search.result(current)).toBeVisible({ timeout: 1_000 });
        for (const title of [handbook, rota]) {
          const result = search.result(title);
          if (old === 'found') await expect(result.first()).toBeVisible({ timeout: 1_000 });
          else await expect(result).toHaveCount(0, { timeout: 1_000 });
        }
      }).toPass({ timeout: 15_000 });

    await test.step('Before: both are in the sidebar and in search', async () => {
      await screen.goto(handbookId);
      await sidebar.expand(shelf);
      await expect(sidebar.subEntries(shelf)).toHaveText([literally(handbook), literally(current)]);
      await search.openWith();
      await searchFinds('found');
      await search.close();
    });

    await test.step('Archive from the page menu: it says how many sub-pages, then shows the banner', async () => {
      await archive.archive(1);
      await expect(archive.banner(who, shownDate(new Date()))).toBeVisible();
      await expect(archive.unarchiveButton).toBeVisible();
      await expect(screen.content).not.toBeEditable();
      await expect(screen.title).not.toBeEditable();
    });

    await test.step('The sub-page is read-only too, and both are gone from the sidebar', async () => {
      await screen.goto(rotaId);
      await expect(screen.content).not.toBeEditable();
      await sidebar.expand(shelf);
      await expect(sidebar.subEntries(shelf)).toHaveText([literally(current)]);
      await expect(sidebar.entry(rota)).toHaveCount(0);
    });

    await test.step('Search leaves them out, unless Include archived is on', async () => {
      await search.openWith();
      await searchFinds('left out');
      await includeArchived(search).click();
      await searchFinds('found');
      await includeArchived(search).click();
      await searchFinds('left out');
      await search.close();
    });

    await test.step('Unarchive in the banner: editable, in the sidebar and in search again', async () => {
      await screen.goto(handbookId);
      await archive.unarchive(1);
      await expect(archive.unarchiveButton).toBeHidden();
      await expect(screen.content).toBeEditable();
      await sidebar.expand(shelf);
      await expect(sidebar.subEntries(shelf)).toHaveText([literally(handbook), literally(current)]);
      await sidebar.expand(handbook);
      await expect(sidebar.subEntries(handbook)).toHaveText([literally(rota)]);
      await screen.goto(rotaId);
      await expect(screen.content).toBeEditable();
      await search.openWith();
      await searchFinds('found');
      await search.close();
    });
  });
});
