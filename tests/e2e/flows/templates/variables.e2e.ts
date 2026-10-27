import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { addProperty, config, getRow, makeDatabase } from '../databases/database-api.js';
import { DatabaseScreen } from '../databases/database-page.js';
import { dayIn } from '../knowledge-base/kb-page.js';
import { openAs } from '../pages/page-screen.js';
import { nameOf } from '../sharing/share-dialog.js';
import { NewRowMenu, addRowBy, addRowTemplate, variable } from './templates-page.js';

// Templates and buttons, section 3.3: template variables in a database template's properties.
// Eli (Editor) makes Tasks in the team space and its template through the API (decision 0200);
// Eli and then Avery (Admin) make a row from it with New ▾. Not covered yet: This page, and a
// Tasks view filtered by This page inside a template, which only the editor can make so far.

test.describe('Templates: template variables', () => {
  onlyIn('desktop-light');
  needs('signIn', 'appShell', 'pages', 'databases', 'templates');

  test('TB-05 a template with Due as Today + 3 days, Started as Now and Owner as Me fills them in for whoever makes the row', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'editor');
    const tasks = await makeDatabase(page, uniqueName('Fictional QA Tasks'));
    const due = await addProperty(page, tasks.id, 'Due', config.date());
    const started = await addProperty(page, tasks.id, 'Started', config.date());
    const owner = await addProperty(page, tasks.id, 'Owner', config.person());
    const template = await addRowTemplate(page, tasks.id, 'Fictional QA follow-up', {
      [due.id]: variable.today(3),
      [started.id]: variable.now(),
      [owner.id]: variable.me(),
    });
    const eli = await nameOf(page);
    const fromTemplate = (screen: DatabaseScreen) =>
      addRowBy(screen, async () => {
        const menu = new NewRowMenu(screen);
        await menu.open();
        await menu.item(template.name).click();
      });
    const screen = new DatabaseScreen(page, tasks.id);

    await test.step('Eli: New ▾ → the template makes a row due in 3 days, started now, owned by Eli', async () => {
      await screen.open();
      const madeAt = Date.now();
      await fromTemplate(screen);
      await expect(screen.column(due.id)).toContainText([dayIn(3).shown]);
      await expect(screen.column(started.id)).toContainText([dayIn(0).shown]);
      await expect(screen.column(owner.id)).toContainText([eli]);
      // The variables became real values when the row was made: a calendar day and a moment.
      const rowId = await screen.rows().first().getAttribute('data-row-id');
      const row = await getRow(page, tasks.id, rowId ?? '');
      expect(row.values[due.id]).toMatchObject({ start: dayIn(3).iso, hasTime: false });
      const startedAt = row.values[started.id] as { start: string; hasTime: boolean };
      expect(startedAt.hasTime).toBe(true);
      expect(Math.abs(Date.parse(startedAt.start) - madeAt)).toBeLessThan(2 * 60_000);
    });

    await test.step('Avery: the same template makes a row owned by Avery', async () => {
      const avery = await openAs(browser, 'admin');
      try {
        const averyName = await nameOf(avery.page);
        const asAvery = new DatabaseScreen(avery.page, tasks.id);
        await asAvery.open();
        await fromTemplate(asAvery);
        await expect(asAvery.column(owner.id)).toContainText([eli, averyName]);
        await expect(asAvery.column(due.id)).toContainText([dayIn(3).shown, dayIn(3).shown]);
      } finally {
        await avery.close();
      }
    });
  });
});
