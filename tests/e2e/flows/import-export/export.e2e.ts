import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { ExportScreen, filesIn, linksIn, makeDatabaseIn, pathOf, target } from './export-screen.js';
import { markdownZip } from './import-files.js';
import { FORBIDDEN, ImportScreen, escaped, makeEmptyPage, openAs } from './import-screen.js';
import { isPng } from './zip-files.js';

// Import and export spec: IE-12, and the part of IE-15 that says an export's download link works
// only for the person who made it. Eli (editor) exports a page of his own in General; it gets its
// sub-pages and pictures from an import of the IE-01 Markdown zip, and a database from the API.

test.describe('Export: pages leave as files that work offline', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'editor', 'importExport');

  test.describe('with a database', () => {
    needs('databases');

    test('IE-12 a Markdown and CSV export of a page with sub-pages and a database opens offline, with working relative links and pictures', async ({
      page,
    }) => {
      await signInAs(page, 'editor');
      const exported = await makeEmptyPage(page, uniqueName('Fictional QA export'));
      const importer = new ImportScreen(page);
      await importer.openOn(exported.id);
      await importer.choose('Text and Markdown', markdownZip());
      await importer.run();
      await makeDatabaseIn(page, exported.id, 'Callbacks', ['Call Rowan', 'Call Sky']);

      const exporter = new ExportScreen(page);
      await exporter.openOn(exported.id);
      await exporter.markdownWithSubPages();
      const files = await filesIn(await exporter.download());

      // Each page is a .md file that starts with its title as a heading; rows are pages too.
      const titles = [exported.title, 'Intake guide', 'Escalations', 'Escalation steps'];
      for (const title of [...titles, 'Call Rowan', 'Call Sky']) {
        expect(files.get(pathOf(files, `${title}.md`))?.toString('utf8')).toMatch(
          new RegExp(`^# ${escaped(title)}(\\r?\\n|$)`),
        );
      }
      // Offline: every relative link and picture in every page leads to a file in the export.
      for (const [path, data] of files) {
        if (!path.endsWith('.md')) continue;
        for (const { to } of linksIn(data.toString('utf8'))) {
          const file = target(path, to);
          if (file !== null) expect(files.has(file), `${path} links to ${to}`).toBe(true);
        }
      }
      // The link between the two exported pages is relative, and each picture is in the export.
      for (const [from, to] of [
        ['Intake guide', 'Escalation steps'],
        ['Escalation steps', 'Intake guide'],
      ] as const) {
        const path = pathOf(files, `${from}.md`);
        const links = linksIn(files.get(path)?.toString('utf8') ?? '');
        const pages = links.filter((found) => !found.picture && found.text === to);
        expect(pages.map((found) => target(path, found.to))).toEqual([pathOf(files, `${to}.md`)]);
        const pictures = links.filter((found) => found.picture);
        expect(pictures).toHaveLength(1);
        expect(isPng(files.get(target(path, pictures[0]?.to ?? '') ?? ''))).toBe(true);
      }
      // The database as CSV, with its rows.
      const csv = files.get(pathOf(files, 'Callbacks.csv'))?.toString('utf8') ?? '';
      expect(csv).toContain('Call Rowan');
      expect(csv).toContain('Call Sky');
    });
  });

  test('IE-15 an export downloads only for the person who made it: Val (viewer) is refused (403)', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'editor');
    const exported = await makeEmptyPage(page, uniqueName('Fictional QA export'));
    const exporter = new ExportScreen(page);
    await exporter.openOn(exported.id);
    const download = await exporter.download();
    const address = download.url();
    expect(address, 'a download link the server answers').toMatch(/^https?:/);

    const val = await openAs(browser, 'viewer');
    const refused = await (await apiFor(val.page)).send('GET', address);
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toEqual(FORBIDDEN);
    await val.close();
  });
});
