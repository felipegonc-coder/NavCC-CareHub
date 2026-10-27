import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, literally } from '../pages/page-screen.js';
import { Sidebar } from '../sidebar/sidebar-page.js';
import { TrashWindow, confirmDialog, moveToTrash, movedToTrash } from './history-page.js';

// Page history and Trash, section 3.4: a page with sub-pages goes to Trash as one entry, and Undo
// or Restore puts it back where it was; restoring a page whose parent is in Trash asks first.

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

test.describe('Trash: restoring a page whose parent is in Trash too', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'trashHistory');

  test('HT-10 restoring a page whose parent is in Trash offers Restore both, Move to… and Cancel, and each works', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tag = uniqueName('Fictional QA').split(' ').pop()!;
    const shelf = `Fictional QA restore shelf ${tag}`;
    const policies = `Fictional QA Policies ${tag}`;
    const refund = `Fictional QA Refund steps ${tag}`;
    const exchange = `Fictional QA Exchange steps ${tag}`;

    await signInAs(page, 'editor');
    const shelfId = await makePage(page, shelf);
    const policiesId = await makePage(page, policies, { parentId: shelfId });
    const refundId = await makePage(page, refund, { parentId: policiesId });
    const exchangeId = await makePage(page, exchange, { parentId: policiesId });
    // The two sub-pages go to Trash one by one, then Policies: three Trash entries.
    for (const id of [refundId, exchangeId, policiesId]) await moveToTrash(page, id);

    const sidebar = new Sidebar(page);
    const trash = new TrashWindow(page);
    const asks = (title: string) =>
      confirmDialog(
        page,
        `${policies} is in Trash too. Restore it as well, or move ${title} somewhere else?`,
      );
    /** Searches Trash for a title, opening the window again if it closed. */
    const findInTrash = async (title: string) => {
      if (!(await trash.dialog.isVisible())) await trash.open();
      await trash.find(title);
    };
    const closeTrash = async () => {
      if (await trash.dialog.isVisible()) await page.keyboard.press('Escape');
      await expect(trash.dialog).toBeHidden();
    };

    await test.step('Restore on Refund steps asks first: Restore both, Move to… or Cancel', async () => {
      await findInTrash(refund);
      await trash.restore(refund);
      await expect(asks(refund)).toBeVisible();
      for (const name of [/^restore both/i, /^move to/i, /^cancel/i]) {
        await expect(asks(refund).getByRole('button', { name })).toBeVisible();
      }
    });

    await test.step('Cancel: Refund steps and Policies stay in Trash', async () => {
      await asks(refund)
        .getByRole('button', { name: /^cancel/i })
        .click();
      await expect(asks(refund)).toBeHidden();
      await findInTrash(refund);
      await expect(trash.item(refund).first()).toBeVisible();
      await findInTrash(policies);
      await expect(trash.item(policies).first()).toBeVisible();
    });

    await test.step('Move to…: Refund steps comes back under the shelf; Policies stays in Trash', async () => {
      await findInTrash(refund);
      await trash.restore(refund);
      await asks(refund)
        .getByRole('button', { name: /^move to/i })
        .click();
      const picker = page.getByRole('dialog', { name: /^move/i });
      await picker.getByRole('searchbox').or(picker.getByRole('textbox')).first().fill(shelf);
      await picker
        .getByRole('option', { name: literally(shelf) })
        .or(picker.getByRole('button', { name: literally(shelf) }))
        .first()
        .click();
      await expect(picker).toBeHidden();
      await findInTrash(refund);
      await expect(trash.item(refund)).toHaveCount(0);
      await findInTrash(policies);
      await expect(trash.item(policies).first()).toBeVisible();
      await closeTrash();
      await sidebar.expand(shelf);
      await expect(sidebar.entry(refund, sidebar.entry(shelf))).toBeVisible();
      await expect(sidebar.entry(policies)).toHaveCount(0);
    });

    await test.step('Restore both: Policies is back under the shelf, with Exchange steps inside', async () => {
      await findInTrash(exchange);
      await trash.restore(exchange);
      await asks(exchange)
        .getByRole('button', { name: /^restore both/i })
        .click();
      await expect(asks(exchange)).toBeHidden();
      await findInTrash(tag);
      await expect(trash.item(tag)).toHaveCount(0);
      await closeTrash();
      await sidebar.expand(shelf);
      await expect(sidebar.entry(policies, sidebar.entry(shelf))).toBeVisible();
      await sidebar.expand(policies);
      await expect(sidebar.subEntries(policies)).toHaveText([literally(exchange)]);
    });
  });
});
