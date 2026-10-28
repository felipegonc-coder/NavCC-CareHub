import type { Page } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { makePage } from '../pages/page-data.js';
import { Editor } from '../editor/editor-page.js';
import { PageScreen, openAs } from '../pages/page-screen.js';
import { VersionHistory, restoredNote, whoIs } from './history-page.js';

// Page history and Trash, sections 2, 3.1 and 3.2: automatic versions, Show changes, and restoring
// a version while someone else is typing. Versions come after 2 minutes without edits, so these
// tests wait.

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

test.describe('Page history: Show changes', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'slashMenu', 'trashHistory');

  test('HT-04 Show changes marks what a version added and removed, struck through and for screen readers', async ({
    page,
  }) => {
    test.setTimeout(7 * MINUTE);
    const greet = 'Fictional QA Greet the client.';
    const yourName = 'Fictional QA Say your name.';
    const rules = 'Fictional QA Check the refund rules.';
    const callBack = 'Fictional QA Call back within 2 days.';
    const caseNote = 'Fictional QA Write the case note.';
    await signInAs(page, 'editor');
    const editor = await Editor.onNewPage(page);
    const history = new VersionHistory(page);
    const shown = (text: string) => history.dialog.getByText(text);

    await test.step('Three blocks; 2 minutes later they are the first version', async () => {
      await editor.typeBlocks(greet, rules, callBack);
      await editor.expectBlocks(greet, rules, callBack);
      await waitUntil(page, Date.now(), 2 * MINUTE);
      await history.waitForVersions(1, MINUTE);
    });

    await test.step('Change the first block, delete the second, add a fourth; then a second version', async () => {
      await editor.content.getByText(greet, { exact: true }).click();
      await page.keyboard.press('End');
      await page.keyboard.type(` ${yourName}`);
      await editor.selectBlocks(rules, 1);
      const menu = await editor.openBlockMenu();
      await menu.getByRole('menuitem', { name: /^delete/i }).click();
      await editor.content.getByText(callBack, { exact: true }).click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type(caseNote);
      await editor.expectBlocks(`${greet} ${yourName}`, callBack, caseNote);
      await waitUntil(page, Date.now(), 2 * MINUTE);
      await history.waitForVersions(2, MINUTE);
    });

    await test.step('The newest version, Show changes on: removed text struck through, added not', async () => {
      await history.open();
      await history.versions.first().click();
      await expect(history.showChanges).toBeChecked();
      await expect(shown(rules)).toBeVisible();
      expect(await editor.decoration(shown(rules))).toContain('line-through');
      for (const added of [yourName, caseNote, callBack]) {
        await expect(shown(added)).toBeVisible();
        expect(await editor.decoration(shown(added))).not.toContain('line-through');
      }
      // Not only by color: a screen reader hears "added" and "removed" (section 6).
      expect(await history.heard()).toMatch(/\badded\b/i);
      expect(await history.heard()).toMatch(/\bremoved\b/i);
    });

    await test.step('Show changes off: the version as it was, without marks; on again: marked', async () => {
      await history.showChanges.click();
      await expect(history.showChanges).not.toBeChecked();
      await expect(shown(rules)).toHaveCount(0);
      await expect(shown(caseNote)).toBeVisible();
      expect(await history.heard()).not.toMatch(/\b(added|removed)\b/i);
      await history.showChanges.click();
      await expect(shown(rules)).toBeVisible();
      await history.close();
    });
  });
});

test.describe('Page history: copying from a version', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'editor', 'trashHistory');

  test('HT-07 two blocks copied from an old version paste into the page with their formatting', async ({
    page,
  }) => {
    test.setTimeout(5 * MINUTE);
    const heading = 'Fictional QA Refund rules';
    const bold = 'Fictional QA to the same card';
    const today = 'Fictional QA The page says something else today.';
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await signInAs(page, 'editor');
    const editor = await Editor.onNewPage(page);
    const history = new VersionHistory(page);

    await test.step('A Heading 2 and a line with bold text; 2 minutes later, a version', async () => {
      await page.keyboard.type(`## ${heading}`);
      await page.keyboard.press('Enter');
      await page.keyboard.type('Fictional QA Refunds go back ');
      await page.keyboard.press('ControlOrMeta+B');
      await page.keyboard.type(bold);
      await page.keyboard.press('ControlOrMeta+B');
      await expect(editor.block('Heading 2')).toHaveText(heading);
      await waitUntil(page, Date.now(), 2 * MINUTE);
      await history.waitForVersions(1, MINUTE);
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type(today);
    });

    await test.step('Select both blocks in the preview (Show changes off) and copy them', async () => {
      await history.open();
      await history.versions.first().click();
      await history.showChanges.uncheck();
      const from = (await history.dialog.getByText(heading, { exact: true }).boundingBox())!;
      const to = (await history.dialog.getByText(bold, { exact: true }).boundingBox())!;
      await page.mouse.move(from.x + 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.press('ControlOrMeta+C');
      await history.close();
    });

    await test.step('Pasted after the last line, they are a Heading 2 and bold text again', async () => {
      await editor.content.getByText(today, { exact: true }).click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.press('ControlOrMeta+V');
      await expect(editor.block('Heading 2')).toHaveText([heading, heading]);
      const bolds = editor.content.getByText(bold, { exact: true });
      await expect(bolds).toHaveCount(2);
      const weights = await bolds.evaluateAll((all) =>
        all.map((text) => Number(getComputedStyle(text).fontWeight)),
      );
      for (const weight of weights) expect(weight).toBeGreaterThanOrEqual(600);
    });
  });
});
