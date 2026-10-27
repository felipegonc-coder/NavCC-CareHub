import { expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import { VersionHistory, restoredNote, whoIs } from '../history-trash/history-page.js';
import { notionExport } from '../import-export/import-files.js';
import {
  ImportScreen,
  escaped,
  link,
  makeEmptyPage,
  pageHref,
  pagesUnder,
} from '../import-export/import-screen.js';
import { PageScreen } from '../pages/page-screen.js';
import { SearchWindow } from '../search/search-window.js';

// FLOW-04, import → search → history (specs README, cross-area flows; IE-04, SR-09, HT-02):
// Import and export (section 2), Search (sections 2 and 3.3) and Page history (sections 3.1 and
// 3.2). Eli (Editor) imports the Notion export of import-files.ts into a new page of his own in
// General, finds a phrase of its top page, "Fictional QA Support", with search, rewrites that
// phrase, then restores the version that holds the imported text.

const MINUTE = 60_000;

/** The top page of the export says this (import-files.ts, notionExport). */
const PHRASE = 'Fictional team notes for the import check.';
const EDITED = 'Fictional QA notes rewritten after the import.';
const TOP = 'Fictional QA Support';
const CHILDREN = ['Callbacks', 'Contacts', 'Shifts', 'Escalation notes'];

test.describe('Cross-area flow: an import is found by search and its text comes back from history', () => {
  onlyIn('desktop-light');
  needs(
    'signIn',
    'appShell',
    'pages',
    'editor',
    'databases',
    'importExport',
    'search',
    'trashHistory',
  );

  test('FLOW-04 a Notion export with 3 databases comes back with its tree, databases and links, search finds a phrase from it, and restoring the imported version brings that text back after an edit', async ({
    page,
  }) => {
    // The imported version is saved 2 minutes after the import's last save (section 3.1).
    test.setTimeout(8 * MINUTE);
    await signInAs(page, 'editor');
    const eli = await whoIs(page);
    const notion = notionExport();
    const destination = await makeEmptyPage(page);

    await test.step('Import: 3 databases and 4 rows, with the formulas listed as problems', async () => {
      const importer = new ImportScreen(page);
      await importer.openOn(destination.id);
      await importer.choose('Notion export', notion.file);
      await expect(await importer.run()).toHaveText(
        new RegExp(
          `\\b3 databases\\b.*\\b${notion.rows} rows\\b.* into ${escaped(destination.title)}\\.$`,
        ),
      );
      for (const formula of notion.formulas) {
        await expect(importer.problem(formula, /formula/i).first()).toBeVisible();
      }
    });

    const tree = await pagesUnder(page, destination.id);
    const id = (path: string) => tree.get(`${TOP}${path}`) ?? '';
    await test.step('The page tree, the databases with their rows and the links come back', async () => {
      expect([...tree.keys()].sort()).toEqual(notion.tree);
      await page.goto(`/p/${id('')}`);
      for (const child of CHILDREN) {
        await expect(link(page, child)).toHaveAttribute('href', pageHref(id(`/${child}`)));
      }
      await page.goto(`/p/${id('/Escalation notes')}`);
      await expect(link(page, TOP)).toHaveAttribute('href', pageHref(id('')));
      await page.goto(`/p/${id('/Callbacks')}`);
      for (const row of ['Call Rowan', 'Call Sky']) {
        await expect(page.getByRole('row', { name: new RegExp(row) })).toBeVisible();
      }
    });

    const screen = new PageScreen(page);
    await test.step('Search finds the phrase on the imported page, which opens from the result', async () => {
      const search = new SearchWindow(page);
      // Heard as "Fictional QA Support, page in General › <destination>, …" (Search, section 6).
      const result = search.dialog.getByRole('option', {
        name: new RegExp(`^${escaped(TOP)}\\b.*${escaped(destination.title)}`),
      });
      await search.openWith();
      await expect(async () => {
        await search.searchFor('');
        await search.searchFor(PHRASE);
        await expect(result).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 10_000 });
      await expect(result).toContainText(PHRASE);
      await result.click();
      await expect(page).toHaveURL(pageHref(id('')));
      await expect(screen.content).toContainText(PHRASE);
    });

    const history = new VersionHistory(page);
    await test.step('About 2 minutes after the import, Version history has the imported version', async () => {
      await history.waitForVersions(1, 4 * MINUTE);
      await history.open();
      await history.versions.first().click();
      await expect(history.dialog).toContainText(PHRASE);
      await history.close();
    });

    await test.step('Eli rewrites the imported phrase, and the edit is saved', async () => {
      await screen.content.getByText(PHRASE).click({ clickCount: 3 });
      await page.keyboard.type(EDITED);
      await expect(screen.content).toContainText(EDITED);
      await expect(screen.content).not.toContainText(PHRASE);
      const again = await screen.openAgain();
      await expect(again.content).toContainText(EDITED);
      await again.page.close();
    });

    await test.step('Restoring the imported version brings the phrase and the links back', async () => {
      await history.open();
      const before = await history.versions.count();
      const from = await history.restore(history.versions.last());
      await expect(restoredNote(page, eli, from)).toBeVisible();
      await expect(screen.content).toContainText(PHRASE);
      await expect(screen.content).not.toContainText(EDITED);
      for (const child of CHILDREN) {
        await expect(link(page, child)).toHaveAttribute('href', pageHref(id(`/${child}`)));
      }
      const again = await screen.openAgain();
      await expect(again.content).toContainText(PHRASE);
      await again.page.close();

      // HT-02: the restore saved the page with the edit as a version first.
      await history.open();
      await expect(history.versions).toHaveCount(before + 1);
      await history.versions.first().click();
      await expect(history.dialog).toContainText(EDITED);
      await history.close();
    });
  });
});
