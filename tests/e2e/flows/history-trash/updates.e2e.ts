import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, literally, openAs } from '../pages/page-screen.js';
import { ShareDialog, nameOf } from '../sharing/share-dialog.js';
import { UpdatesPanel } from './updates-and-archive.js';

// Page history and Trash, sections 2 and 3.3: the Updates panel lists what happened on a page,
// with names and times, and never the title of a page the person can't open.

const MINUTE = 60_000;
/** A time as entries show it: "3:12 PM", or "just now" and "2 minutes ago". */
const A_TIME = /\d{1,2}:\d{2}\s?[AP]M|\bjust now\b|\bago\b/i;

test.describe('Updates: what happened on a page', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'sharing', 'comments', 'trashHistory');

  test('HT-08 Updates on a busy page shows the edit, rename, move, sharing and comment with names and times, and hides pages a reader cannot open', async ({
    page,
    browser,
  }) => {
    test.setTimeout(5 * MINUTE);
    const tag = uniqueName('Fictional QA').split(' ').pop()!;
    const title = `Fictional QA Busy page ${tag}`;
    const from = `Fictional QA Old shelf ${tag}`;
    const to = `Fictional QA New shelf ${tag}`;
    const comment = `Fictional QA comment from Casey ${tag}`;

    // Both shelves are Eli's private pages; Casey gets the busy page only.
    await signInAs(page, 'editor');
    const fromId = await makePage(page, from, { space: 'Private' });
    await makePage(page, to, { space: 'Private' });
    const id = await makePage(page, title, { parentId: fromId });
    const eli = await nameOf(page);
    const casey = await openAs(browser, 'commenter');
    const caseyName = await nameOf(casey.page);
    const screen = new PageScreen(page);

    await test.step('Eli edits, renames, shares and moves the page; Casey comments on it', async () => {
      await screen.goto(id);
      await screen.typeAtEnd('Fictional QA First steps for a refund.');
      await screen.title.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' v2');
      await screen.expectTitle(`${title} v2`);
      const share = new ShareDialog(page);
      await share.open();
      await share.invite(caseyName, 'Can comment');
      await share.closeWithEscape();
      const menu = await screen.openPageMenu();
      await menu.getByRole('menuitem', { name: 'Move to', exact: true }).click();
      const picker = page.getByRole('dialog', { name: /^move/i });
      await picker.getByRole('searchbox').or(picker.getByRole('textbox')).first().fill(to);
      await picker
        .getByRole('option', { name: literally(to) })
        .or(picker.getByRole('button', { name: literally(to) }))
        .first()
        .click();
      await expect(picker).toBeHidden();
      await (await apiFor(casey.page)).post('/api/comments', { pageId: id, text: comment });
    });

    await test.step("Eli's Updates: each change, with names, times and Show changes", async () => {
      const updates = new UpdatesPanel(page);
      await updates.waitFor(/\bedited\b/i, 3 * MINUTE);
      await updates.open();
      for (const what of [/\brenamed\b/i, /\bmoved\b/i, /\bshared\b/i, /\bcomment/i, A_TIME]) {
        await expect(updates.panel).toContainText(what);
      }
      for (const text of [eli, caseyName, to]) await expect(updates.panel).toContainText(text);
      await expect(updates.showChanges.first()).toBeVisible();
      await updates.close();
    });

    await test.step('Casey\'s Updates: who did what and when, the shelves as "a page you can\'t open"', async () => {
      const theirs = new PageScreen(casey.page);
      await theirs.goto(id);
      const updates = new UpdatesPanel(casey.page);
      await updates.open();
      for (const what of [/\bedited\b/i, /\bmoved\b/i, A_TIME]) {
        await expect(updates.panel).toContainText(what);
      }
      await expect(updates.panel).toContainText(eli);
      await expect(updates.panel).toContainText("a page you can't open");
      for (const shelf of [from, to]) await expect(updates.panel).not.toContainText(shelf);
      // Show changes needs Can edit; Casey can comment.
      await expect(updates.showChanges).toHaveCount(0);
      await updates.close();
    });
    await casey.close();
  });
});
