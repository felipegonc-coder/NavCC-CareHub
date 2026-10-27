import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen } from '../pages/page-screen.js';
import { Sidebar } from '../sidebar/sidebar-page.js';
import { TrashWindow, movedToTrash } from './history-page.js';

// Page history and Trash, section 3.4: a page with sub-pages goes to Trash as one entry, and Undo
// or Restore puts it back where it was.

test.describe('Trash: a page with its sub-pages', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'comments', 'trashHistory');

  test('HT-09 a page with 12 sub-pages makes one Trash entry; Undo, and later Restore, put it back in the same place with its sub-pages and comments', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // One word for every title, so a Trash search for it lists all that went to Trash.
    const tag = uniqueName('Fictional QA').split(' ').pop()!;
    const shelf = `Fictional QA trash shelf ${tag}`;
    const before = `Fictional QA Before ${tag}`;
    const policies = `Fictional QA Policies ${tag}`;
    const after = `Fictional QA After ${tag}`;
    const sections = Array.from({ length: 12 }, (_, n) => `Fictional QA Section ${n + 1} ${tag}`);
    const comment = `Fictional QA comment on Policies ${tag}`;

    await signInAs(page, 'editor');
    const shelfId = await makePage(page, shelf);
    await makePage(page, before, { parentId: shelfId });
    const policiesId = await makePage(page, policies, { parentId: shelfId });
    await makePage(page, after, { parentId: shelfId });
    for (const section of sections) await makePage(page, section, { parentId: policiesId });
    await (await apiFor(page)).post('/api/comments', { pageId: policiesId, text: comment });

    const screen = new PageScreen(page);
    const sidebar = new Sidebar(page);
    const trash = new TrashWindow(page);
    const toast = movedToTrash(page);
    const topOf = async (title: string) => (await sidebar.entry(title).boundingBox())?.y ?? NaN;

    /** Policies is back between Before and After, with its 12 sub-pages and its comment. */
    const expectBackInPlace = async () => {
      await sidebar.expand(shelf);
      await expect(sidebar.entry(policies)).toBeVisible();
      const [one, two, three] = [await topOf(before), await topOf(policies), await topOf(after)];
      expect(one).toBeLessThan(two);
      expect(two).toBeLessThan(three);
      await sidebar.expand(policies);
      await expect(sidebar.subEntries(policies)).toHaveCount(12);
      await screen.goto(policiesId);
      await expect(screen.main.getByText(comment)).toBeVisible();
    };

    const moveToTrash = async () => {
      await screen.goto(policiesId);
      await sidebar.expand(shelf);
      const menu = await screen.openPageMenu();
      await menu.getByRole('menuitem', { name: /^move to trash/i }).click();
      await expect(toast.message).toBeVisible();
      await expect(sidebar.entry(policies)).toHaveCount(0);
    };

    await test.step('Policies sits between Before and After', async () => {
      await screen.goto(policiesId);
      await sidebar.expand(shelf);
      const [one, two, three] = [await topOf(before), await topOf(policies), await topOf(after)];
      expect(one).toBeLessThan(two);
      expect(two).toBeLessThan(three);
    });

    await test.step('Move to Trash from the page menu, then Undo within 8 seconds', async () => {
      await moveToTrash();
      await toast.undo.click();
      await expectBackInPlace();
    });

    await test.step('Move it to Trash again: one entry, "and 12 sub-pages"', async () => {
      await moveToTrash();
      await trash.open();
      await trash.find(tag);
      await expect(trash.item(policies).first()).toContainText('and 12 sub-pages');
      await expect(trash.item(tag)).toHaveCount(1);
    });

    await test.step('Restore from Trash: back in the same place, with sub-pages and comment', async () => {
      await trash.find(policies);
      await trash.restore(policies);
      await expect(trash.item(policies)).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(trash.dialog).toBeHidden();
      await expectBackInPlace();
    });
  });
});
