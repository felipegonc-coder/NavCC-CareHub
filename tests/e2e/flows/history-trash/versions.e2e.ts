import type { Page } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { PageScreen, openAs } from '../pages/page-screen.js';
import { VersionHistory, restoredNote, whoIs } from './history-page.js';

// Page history and Trash, sections 3.1 and 3.2: automatic versions, and restoring one while
// someone else is typing. Versions come after 2 minutes without edits, so these tests wait.

const MINUTE = 60_000;

/** Waits until `ms` after `since`. Only for the spec's time rules. */
async function waitUntil(page: Page, since: number, ms: number) {
  const left = since + ms - Date.now();
  if (left > 0) await page.waitForTimeout(left);
}

test.describe('Page history: automatic versions and restoring one', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'coEditing', 'trashHistory');

  test('HT-01 editing, then pausing for 2 minutes, saves one version naming everyone who edited', async ({
    page,
    browser,
  }) => {
    test.setTimeout(5 * MINUTE);
    await signInAs(page, 'editor');
    const id = await makePage(page, uniqueName('Fictional QA Refund steps'));
    const screen = new PageScreen(page);
    await screen.goto(id);
    const avery = await openAs(browser, 'admin');
    const theirs = new PageScreen(avery.page);
    await theirs.goto(id);
    const names = [await whoIs(page), await whoIs(avery.page)];
    const history = new VersionHistory(page);

    await test.step('Before the first edits there is no version', async () => {
      await history.open();
      await expect(history.empty).toBeVisible();
      await history.close();
    });

    let lastEdit = 0;
    await test.step('Eli and Avery both edit the page', async () => {
      for (let round = 1; round <= 3; round += 1) {
        await screen.typeAtEnd(` Fictional QA Eli ${round}.`);
        await theirs.typeAtEnd(` Fictional QA Avery ${round}.`);
      }
      await expect(screen.content).toContainText('Fictional QA Avery 3.');
      await expect(theirs.content).toContainText('Fictional QA Eli 3.');
      lastEdit = Date.now();
    });
    await avery.close();

    await test.step('1 minute 45 seconds after the last edit there is still no version', async () => {
      await waitUntil(page, lastEdit, 105_000);
      await history.open();
      await expect(history.empty).toBeVisible();
      await history.close();
    });

    await test.step('Soon after 2 minutes: one version, naming Eli and Avery', async () => {
      await waitUntil(page, lastEdit, 2 * MINUTE);
      await history.waitForVersions(1, MINUTE);
      await history.open();
      const version = history.versions.first();
      await expect(version).toContainText(/\d{1,2}:\d{2}\s?[AP]M/);
      for (const name of names) await expect(version).toContainText(name);
      await history.close();
    });
  });

  test('HT-05 restoring a version while another person types keeps their text in the version saved just before, and both see the note', async ({
    page,
    browser,
  }) => {
    test.setTimeout(5 * MINUTE);
    const first = 'Fictional QA first draft.';
    const second = 'Fictional QA second draft.';
    const averys = 'Fictional QA Avery typed this first.';
    await signInAs(page, 'editor');
    const id = await makePage(page, uniqueName('Fictional QA Refund steps'));
    const screen = new PageScreen(page);
    await screen.goto(id);
    const history = new VersionHistory(page);
    const eli = await whoIs(page);

    await test.step('Eli writes a first draft; 2 minutes later it is a version', async () => {
      await screen.typeAtEnd(first);
      const edited = Date.now();
      await waitUntil(page, edited, 2 * MINUTE);
      await history.waitForVersions(1, MINUTE);
    });

    const avery = await openAs(browser, 'admin');
    const theirs = new PageScreen(avery.page);
    await test.step('Eli adds a second draft, and Avery types on the same page', async () => {
      await screen.typeAtEnd(` ${second}`);
      await theirs.goto(id);
      await theirs.typeAtEnd(` ${averys}`);
      await expect(screen.content).toContainText(averys);
    });

    let from = '';
    await test.step('While Avery is still typing, Eli restores the first version', async () => {
      await theirs.content.click();
      await avery.page.keyboard.press('ControlOrMeta+End');
      const typing = avery.page.keyboard.type(' Fictional QA still typing during the restore.', {
        delay: 100,
      });
      await history.open();
      from = await history.restore(history.versions.last());
      await typing;
    });

    await test.step('Both see the note, and the page is the first draft again for both', async () => {
      await expect(restoredNote(page, eli, from)).toBeVisible();
      await expect(restoredNote(avery.page, eli, from)).toBeVisible();
      for (const view of [screen, theirs]) {
        await expect(view.content).toContainText(first);
        await expect(view.content).not.toContainText(second);
        await expect(view.content).not.toContainText(averys);
      }
    });

    await test.step("Avery's text is in the version saved just before the restore", async () => {
      await history.open();
      await expect(history.versions).toHaveCount(2);
      await history.versions.first().click();
      await expect(history.dialog).toContainText(averys);
      await expect(history.dialog).toContainText(second);
      await history.close();
    });
    await avery.close();
  });
});
