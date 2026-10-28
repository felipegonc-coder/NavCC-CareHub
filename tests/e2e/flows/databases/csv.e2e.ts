import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import {
  exportCsv,
  fileBytes,
  importButton,
  importCsv,
  parseCsv,
  toCsv,
  today,
} from './csv-files.js';
import {
  addProperty,
  addRow,
  config,
  filter,
  getDatabase,
  makeDatabase,
  nameOf,
  optionId,
  propertyNamed,
  tableView,
  updateView,
  value,
  type Database,
  type Property,
} from './database-api.js';
import { DatabaseScreen } from './database-page.js';

/** A database's property names, in alphabetical order. */
function propertyNames(database: Database): string[] {
  return database.properties.map((p) => p.name).sort();
}

/** A Select property's option names, in alphabetical order. */
function optionNames(property: Property): string[] {
  const options = property.config.options as { name: string }[] | undefined;
  return (options ?? []).map((o) => o.name).sort();
}

// Databases spec 3.7 (CSV import) and 3.8 (CSV export): DB-14, DB-15 and DB-16. Each test makes
// its own database through the API, then exports or imports on the screen with "…" in the toolbar.
test.describe('Databases: CSV export and import', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'databases', 'databaseCsv');

  test('DB-14 This view exports its columns, filter and sort as UTF-8', async ({ page }) => {
    await signInAs(page, 'editor');
    const title = uniqueName('Fictional QA Export');
    const database = await makeDatabase(page, title);
    const name = nameOf(database);
    const score = await addProperty(page, database.id, 'Score', config.number());
    const notes = await addProperty(page, database.id, 'Notes', config.text());
    const internal = await addProperty(page, database.id, 'Internal', config.text());
    const rows: [string, number, string][] = [
      ['Fictional QA Alpha', 3, '=SUM(1)'],
      ['Fictional QA Bravo', 9, 'Call back, "soon"'],
      ['Fictional QA Charlie', 1, 'Left out by the filter'],
      ['Fictional QA Delta', 5, ''],
    ];
    for (const [rowTitle, points, note] of rows) {
      await addRow(page, database.id, rowTitle, {
        [score.id]: value.number(points),
        [internal.id]: value.text('Fictional hidden note'),
        ...(note ? { [notes.id]: value.text(note) } : {}),
      });
    }
    // Score above 2, highest first; Notes moved before Score; Internal hidden.
    const table = tableView(database);
    await updateView(page, database.id, table.id, {
      filter: filter.all(filter.where(score.id, 'gt', '2')),
      sorts: [{ propertyId: score.id, direction: 'desc' }],
      properties: [
        { propertyId: name.id, visible: true },
        { propertyId: notes.id, visible: true },
        { propertyId: score.id, visible: true },
        { propertyId: internal.id, visible: false },
      ],
    });
    const screen = new DatabaseScreen(page, database.id);
    await screen.open();
    const day = today();
    const download = await exportCsv(screen, 'This view');
    const bytes = await fileBytes(download);
    const text = bytes.toString('utf8');

    await test.step('The file is named database – view – date', async () => {
      expect(download.suggestedFilename()).toBe(`${title} – ${table.name} – ${day}.csv`);
    });

    await test.step('UTF-8 with a BOM, and CRLF line endings', async () => {
      expect(bytes.toString('hex', 0, 3)).toBe('efbbbf');
      expect(text).toContain('\r\n');
      expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    });

    await test.step('Shown columns in view order; rows filtered, sorted', async () => {
      expect(parseCsv(text)).toEqual([
        [name.name, 'Notes', 'Score'],
        ['Fictional QA Bravo', 'Call back, "soon"', '9'],
        ['Fictional QA Delta', '', '5'],
        ['Fictional QA Alpha', "'=SUM(1)", '3'],
      ]);
    });
  });

  test('DB-15 Everything, imported into a new database, keeps its values', async ({ page }) => {
    test.slow();
    await signInAs(page, 'editor');
    const source = await makeDatabase(page, uniqueName('Fictional QA Round trip'));
    const name = nameOf(source);
    const score = await addProperty(page, source.id, 'Score', config.number());
    const notes = await addProperty(page, source.id, 'Notes', config.text());
    const due = await addProperty(page, source.id, 'Due', config.date());
    const team = await addProperty(page, source.id, 'Team', config.select('North', 'South'));
    const done = await addProperty(page, source.id, 'Done', config.checkbox());
    await addRow(page, source.id, 'Fictional QA Alpha', {
      [score.id]: value.number(3),
      [notes.id]: value.text('Call back, "soon"'),
      [due.id]: value.date('2026-10-26'),
      [team.id]: optionId(team, 'North'),
      [done.id]: true,
    });
    await addRow(page, source.id, 'Fictional QA Bravo', {
      [score.id]: value.number(7.5),
      [notes.id]: value.text('Fictional note'),
      [due.id]: value.date('2026-11-02'),
      [team.id]: optionId(team, 'South'),
      [done.id]: false,
    });
    await addRow(page, source.id, 'Fictional QA Charlie');
    // The view shows only Score above 5 and hides Notes; Everything ignores both.
    await updateView(page, source.id, tableView(source).id, {
      filter: filter.all(filter.where(score.id, 'gt', '5')),
      properties: [name, score, notes, due, team, done].map((p) => ({
        propertyId: p.id,
        visible: p !== notes,
      })),
    });
    const sourceScreen = new DatabaseScreen(page, source.id);
    await sourceScreen.open();
    const exported = await exportCsv(sourceScreen, 'Everything');
    const file = await fileBytes(exported);
    const [header, ...rows] = parseCsv(file.toString('utf8'));

    await test.step('Everything has every property and every row', async () => {
      expect(header).toEqual([name.name, 'Score', 'Notes', 'Due', 'Team', 'Done']);
      expect(rows).toHaveLength(3);
    });

    const copy = await makeDatabase(page, uniqueName('Fictional QA Round trip copy'));
    const copyScreen = new DatabaseScreen(page, copy.id);

    await test.step('Import the file into a new, empty database', async () => {
      await copyScreen.open();
      const dialog = await importCsv(copyScreen, exported.suggestedFilename(), file);
      await importButton(dialog).click();
      await expect(page.getByText('Imported 3 rows.').first()).toBeVisible({ timeout: 30_000 });
      await page.keyboard.press('Escape');
      const imported = await getDatabase(page, copy.id);
      expect(propertyNamed(imported, 'Score').config.type).toBe('number');
      expect(propertyNamed(imported, 'Due').config.type).toBe('date');
    });

    await test.step('Its own Everything export has the same values', async () => {
      const again = await fileBytes(await exportCsv(copyScreen, 'Everything'));
      const [copyHeader, ...copyRows] = parseCsv(again.toString('utf8'));
      expect(copyHeader).toEqual(header);
      expect(copyRows).toHaveLength(rows.length);
      expect(copyRows).toEqual(expect.arrayContaining(rows));
    });
  });

  test('DB-16 Import 50 tickets with two bad dates, then Undo import', async ({ page }) => {
    test.slow();
    await signInAs(page, 'editor');
    const tickets = await makeDatabase(page, uniqueName('Fictional QA Tickets'));
    const name = nameOf(tickets);
    const due = await addProperty(page, tickets.id, 'Due', config.date());
    await addProperty(page, tickets.id, 'Priority', config.select('Low', 'High'));
    const earlier = 'Fictional QA ticket from before';
    await addRow(page, tickets.id, earlier, { [due.id]: value.date('2026-10-20') });
    // "due" matches Due (case is ignored) and Priority gains Urgent; Points and Team are new. The
    // dates in rows 27 and 41, past the 20 rows the preview shows, can't be read.
    const bad = new Map([
      [27, 'someday'],
      [41, 'not sure'],
    ]);
    const lines = [[name.name, 'due', 'Priority', 'Points', 'Team']];
    for (let i = 1; i <= 50; i++) {
      lines.push([
        `Fictional QA ticket ${String(i).padStart(2, '0')}`,
        bad.get(i) ?? `2026-11-${String((i % 28) + 1).padStart(2, '0')}`,
        i % 10 === 0 ? 'Urgent' : i % 2 === 0 ? 'High' : 'Low',
        String(i * 2),
        i % 3 === 0 ? 'Green' : 'Blue',
      ]);
    }
    const screen = new DatabaseScreen(page, tickets.id);
    await screen.open();
    const dialog = await importCsv(screen, 'fictional-qa-tickets.csv', toCsv(lines));

    await test.step('The preview lists both bad dates with their rows', async () => {
      const named = { name: 'First row is headers' };
      const headers = dialog.getByRole('checkbox', named).or(dialog.getByRole('switch', named));
      await expect(headers).toBeChecked();
      const entries = dialog.getByRole('listitem').or(dialog.getByRole('row'));
      for (const [row, text] of bad) {
        const problem = entries.filter({ hasText: text }).first();
        await expect(problem).toContainText(/due/i);
        // A data row number or a file line number (the header is line 1) both name this row.
        await expect(problem).toContainText(new RegExp(`\\b(${row}|${row + 1})\\b`));
      }
    });

    await test.step("Import: 50 rows; 2 values couldn't be read", async () => {
      await importButton(dialog).click();
      const summary = page.getByText("Imported 50 rows. 2 values couldn't be read.");
      await expect(summary.first()).toBeVisible({ timeout: 30_000 });
      const imported = await getDatabase(page, tickets.id);
      const expected = [name.name, 'Due', 'Priority', 'Points', 'Team'].sort();
      expect(propertyNames(imported)).toEqual(expected);
      expect(propertyNamed(imported, 'Points').config.type).toBe('number');
      expect(propertyNamed(imported, 'Team').config.type).toBe('select');
      expect(optionNames(propertyNamed(imported, 'Priority'))).toEqual(['High', 'Low', 'Urgent']);
    });

    await test.step('Undo import takes out its rows, properties, options', async () => {
      await page.getByRole('button', { name: 'Undo import' }).click();
      await expect
        .poll(async () => propertyNames(await getDatabase(page, tickets.id)), { timeout: 30_000 })
        .toEqual([name.name, 'Due', 'Priority'].sort());
      const undone = await getDatabase(page, tickets.id);
      expect(optionNames(propertyNamed(undone, 'Priority'))).toEqual(['High', 'Low']);
      const open = page.getByRole('dialog');
      if ((await open.count()) > 0) await page.keyboard.press('Escape');
      await expect(screen.rows()).toHaveCount(1);
      await expect(screen.row(earlier)).toBeVisible();
      await expect(screen.header('Points')).toHaveCount(0);
    });
  });
});
