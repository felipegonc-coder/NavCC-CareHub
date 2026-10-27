import type { Page } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import {
  FORBIDDEN,
  ImportScreen,
  makeEmptyPage,
  openAs,
  pagesUnder,
  sendAgainAs,
} from './import-screen.js';
import { manyPagesZip, twoPagesZip } from './undo-files.js';
import { IN_TRASH, TrashWindow, UndoImport, progressPanel } from './undo-screen.js';

// Import and export spec: IE-11. Eli (editor) imports a Markdown zip into a new page of his own in
// General, through page menu → Import, then cancels it or undoes it from the summary. Every file
// is made by the test itself (undo-files.ts).

/** Eli imports `file` into a new empty page and waits for the summary; returns the new pages. */
async function importAsEli(page: Page, file: ReturnType<typeof twoPagesZip>) {
  await signInAs(page, 'editor');
  const destination = await makeEmptyPage(page);
  const importer = new ImportScreen(page);
  await importer.openOn(destination.id);
  await importer.choose('Text and Markdown', file);
  await importer.run();
  const tree = await pagesUnder(page, destination.id);
  expect([...tree.keys()].sort()).toEqual(file.tree);
  return { destination, tree };
}

/** The titles left under the page `id`, sorted. */
const titlesUnder = async (page: Page, id: string) =>
  [...(await pagesUnder(page, id)).keys()].sort();

test.describe('Import: Cancel and Undo import', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'importExport');

  test('IE-11 Cancel in the progress panel stops the import and removes what it added', async ({
    page,
  }) => {
    test.slow();
    await signInAs(page, 'editor');
    const file = manyPagesZip(uniqueName('Fictional QA cancel'));
    const destination = await makeEmptyPage(page);
    const importer = new ImportScreen(page);
    await importer.openOn(destination.id);
    await importer.choose('Text and Markdown', file);
    await importer.dialog.getByRole('button', { name: 'Import', exact: true }).click();

    const panel = progressPanel(page, file.name);
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect.poll(() => titlesUnder(page, destination.id), { timeout: 60_000 }).toEqual([]);
    await expect(page.getByText(/^Imported \d/)).toHaveCount(0);
  });

  test.describe('Undo import, with Trash', () => {
    needs('appShell', 'trashHistory');

    test('IE-11 Undo import moves everything the import added to Trash as one entry, and Val (viewer) sending it again is refused (403)', async ({
      page,
      browser,
    }) => {
      test.slow();
      const name = uniqueName('Fictional QA undo');
      const file = twoPagesZip(name);
      const { destination, tree } = await importAsEli(page, file);

      const undo = new UndoImport(page);
      await undo.open();
      const undone = undo.request();
      await undo.confirm();
      await expect.poll(() => titlesUnder(page, destination.id)).toEqual([]);

      const trash = new TrashWindow(page);
      await trash.search(name);
      await expect(trash.items(name)).toHaveCount(1);
      for (const title of file.tree) {
        await page.goto(`/p/${tree.get(title)}`);
        await expect(page.getByText(IN_TRASH)).toBeVisible();
      }

      const val = await openAs(browser, 'viewer');
      const refused = await sendAgainAs(val.page, await undone);
      expect(refused.status()).toBe(403);
      expect(await refused.json()).toEqual(FORBIDDEN);
      await val.close();
    });

    test('IE-11 Undo import lists a page changed since first and keeps it; the rest goes to Trash', async ({
      page,
    }) => {
      test.slow();
      const file = twoPagesZip(uniqueName('Fictional QA undo'));
      const { destination, tree } = await importAsEli(page, file);
      const [intake, steps] = file.tree;
      const edited = `${intake}, edited`;
      await (await apiFor(page)).patch(`/api/pages/${tree.get(intake)}`, { title: edited });

      const undo = new UndoImport(page);
      await undo.open();
      await expect(undo.listed().first()).toContainText(edited);
      await expect(undo.removeThemToo()).not.toBeChecked();
      await undo.confirm();

      await expect.poll(() => titlesUnder(page, destination.id)).toEqual([edited]);
      await page.goto(`/p/${tree.get(steps)}`);
      await expect(page.getByText(IN_TRASH)).toBeVisible();
    });

    test('IE-11 with "Remove them too" ticked, Undo import moves the page changed since to Trash as well', async ({
      page,
    }) => {
      test.slow();
      const file = twoPagesZip(uniqueName('Fictional QA undo'));
      const { destination, tree } = await importAsEli(page, file);
      const [intake] = file.tree;
      await (
        await apiFor(page)
      ).patch(`/api/pages/${tree.get(intake)}`, {
        title: `${intake}, edited`,
      });

      const undo = new UndoImport(page);
      await undo.open();
      await undo.removeThemToo().check();
      await undo.confirm();

      await expect.poll(() => titlesUnder(page, destination.id)).toEqual([]);
      await page.goto(`/p/${tree.get(intake)}`);
      await expect(page.getByText(IN_TRASH)).toBeVisible();
    });
  });
});
