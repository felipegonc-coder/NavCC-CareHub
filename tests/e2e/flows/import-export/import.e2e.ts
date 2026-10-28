import { expect, needs, onlyIn, sendAgainAs, signInAs, test } from '../_support/index.js';
import { markdownZip, notionExport } from './import-files.js';
import {
  FORBIDDEN,
  ImportScreen,
  escaped,
  expectPicture,
  link,
  makeEmptyPage,
  openAs,
  pageHref,
  pagesUnder,
} from './import-screen.js';
import { wordFile } from './word-file.js';

// Import and export spec: IE-04, IE-01 and IE-02. Eli (editor) imports into a new page of his own
// in General, through page menu → Import, so "Add to:" is that page. Every file is made by the
// test itself: see import-files.ts and word-file.ts.

test.describe('Import: files from other tools become pages', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'editor', 'importExport');

  test.describe('with databases', () => {
    needs('databases');

    test('IE-04 a Notion export with 3 databases brings back the page tree, the databases with row pages and the links between pages; formulas are listed as problems', async ({
      page,
    }) => {
      await signInAs(page, 'editor');
      const notion = notionExport();
      const destination = await makeEmptyPage(page);
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

      const tree = await pagesUnder(page, destination.id);
      expect([...tree.keys()].sort()).toEqual(notion.tree);
      const id = (path: string) => tree.get(`Fictional QA Support${path}`) ?? '';
      await page.goto(`/p/${id('')}`);
      for (const child of ['Callbacks', 'Contacts', 'Shifts', 'Escalation notes']) {
        await expect(link(page, child)).toHaveAttribute('href', pageHref(id(`/${child}`)));
      }
      await link(page, 'Escalation notes').click();
      await expect(page).toHaveURL(pageHref(id('/Escalation notes')));
      await expect(link(page, 'Fictional QA Support')).toHaveAttribute('href', pageHref(id('')));
      await link(page, 'Call Rowan').click();
      await expect(page.getByRole('main').getByText(notion.rowText)).toBeVisible();

      await page.goto(`/p/${id('/Callbacks')}`);
      await expect(page.getByRole('row', { name: /Call Rowan/ })).toBeVisible();
      await expect(page.getByRole('row', { name: /Call Sky/ })).toBeVisible();
    });
  });

  test('IE-01 a Markdown zip with folders and pictures becomes a page tree with pictures, and links between the files point at the new pages', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    const handbook = markdownZip();
    const destination = await makeEmptyPage(page);
    const importer = new ImportScreen(page);
    await importer.openOn(destination.id);
    await importer.choose('Text and Markdown', handbook);
    await expect(await importer.run()).toHaveText(
      new RegExp(`^Imported 3 pages\\b.*\\b2 files into ${escaped(destination.title)}\\.$`),
    );

    const tree = await pagesUnder(page, destination.id);
    expect([...tree.keys()].sort()).toEqual(handbook.tree);
    const intake = tree.get('Intake guide') ?? '';
    const steps = tree.get('Escalations/Escalation steps') ?? '';
    await page.goto(`/p/${intake}`);
    await expectPicture(page, 'Front desk');
    await expect(link(page, 'Escalation steps')).toHaveAttribute('href', pageHref(steps));
    await link(page, 'Escalation steps').click();
    await expect(page).toHaveURL(pageHref(steps));
    await expectPicture(page, 'Phone tree');
    await expect(link(page, 'Intake guide')).toHaveAttribute('href', pageHref(intake));
  });

  test('IE-02 a Word file keeps its headings, list, table, picture, link and footnote, and its tracked changes arrive accepted', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    const word = wordFile();
    const destination = await makeEmptyPage(page);
    const importer = new ImportScreen(page);
    await importer.openOn(destination.id);
    await importer.choose('Word', word);
    await importer.run();

    const tree = await pagesUnder(page, destination.id);
    expect(tree.size).toBe(1);
    await page.goto(`/p/${[...tree.values()].join('')}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Before the call' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Questions to ask' })).toBeVisible();
    for (const item of ['Name and pronouns', 'Best time to call back']) {
      await expect(main.getByRole('listitem').filter({ hasText: item })).toBeVisible();
    }
    for (const text of ['Question', 'Why we ask', 'Is now a good time?', 'So the call fits']) {
      await expect(main.getByRole('table')).toContainText(text);
    }
    await expectPicture(page, 'Intake desk');
    await expect(link(page, 'Care Hub help')).toHaveAttribute('href', word.link);
    await expect(main.getByText(word.footnote)).toBeVisible();
    await expect(main.getByText(word.kept)).toBeVisible();
    await expect(main.getByText('home address')).toHaveCount(0);
  });

  test('IE-01 Val (viewer) sending the same import into a page she can only view is refused (403), and nothing more is added', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'editor');
    const handbook = markdownZip();
    const destination = await makeEmptyPage(page);
    const importer = new ImportScreen(page);
    await importer.openOn(destination.id);
    await importer.choose('Text and Markdown', handbook);
    const started = importer.startRequest(destination.id);
    await importer.run();

    const val = await openAs(browser, 'viewer');
    const refused = await sendAgainAs(val.page, await started);
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toEqual(FORBIDDEN);
    expect([...(await pagesUnder(page, destination.id)).keys()].sort()).toEqual(handbook.tree);
    await val.close();
  });
});
