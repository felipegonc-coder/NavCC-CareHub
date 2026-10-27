import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import {
  addProperty,
  addRow,
  config,
  filter,
  makeDatabase,
  nameOf,
  optionId,
  tableView,
  updateView,
  value,
} from './database-api.js';
import { DatabaseScreen } from './database-page.js';

// Databases spec, "Done means" DB-31: the calculation row's Count all, Sum and Percent empty match
// the filtered rows, overall and in each group. Twelve rows match the saved filter and one doesn't;
// the view loads 10 at a time.
test.describe('Databases: column totals', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'databases');

  test('DB-31 totals cover every matching row, per group, after a reload', async ({ page }) => {
    test.slow();
    await signInAs(page, 'editor');
    const tag = uniqueName('Fictional QA');
    const database = await makeDatabase(page);
    const name = nameOf(database);
    const hours = await addProperty(page, database.id, 'Hours', {
      ...config.number(),
      format: 'number_commas',
    });
    const reviewed = await addProperty(page, database.id, 'Reviewed', config.checkbox());
    const notes = await addProperty(page, database.id, 'Notes', config.text());
    const due = await addProperty(page, database.id, 'Due', config.date());
    const team = await addProperty(page, database.id, 'Team', config.select('North', 'South'));
    // Rows 0-7 are North with 1,000 hours each, rows 8-11 South with 1,085: 12,340 in all. Notes
    // stay empty in 7 of the 12: 5 of the 8 North rows and 2 of the 4 South ones.
    for (let i = 0; i < 12; i++) {
      const north = i < 8;
      await addRow(page, database.id, `${tag} keep ${i + 1}`, {
        [hours.id]: value.number(north ? 1000 : 1085),
        [team.id]: optionId(team, north ? 'North' : 'South'),
        [reviewed.id]: [0, 1, 8, 9].includes(i),
        ...([0, 1, 2, 8, 9].includes(i) ? { [notes.id]: value.text('Fictional note') } : {}),
        ...(i === 0 ? { [due.id]: value.date('2026-10-05') } : {}),
        ...(i === 9 ? { [due.id]: value.date('2026-10-12') } : {}),
      });
    }
    await addRow(page, database.id, `${tag} drop`, {
      [hours.id]: value.number(99999),
      [reviewed.id]: true,
      [due.id]: value.date('2026-09-01'),
    });
    const table = tableView(database);
    await updateView(page, database.id, table.id, {
      filter: filter.all(filter.where(name.id, 'contains', `${tag} keep`)),
      loadLimit: 10,
    });
    const screen = new DatabaseScreen(page, database.id);
    await screen.open();

    await test.step('Pick a calculation in each column', async () => {
      await screen.calculate(name.id, 'Count all');
      await screen.calculate(hours.id, 'Sum');
      await screen.calculate(reviewed.id, 'Percent checked');
      await screen.calculate(notes.id, 'Percent empty');
      await screen.calculate(due.id, /^Earliest/);
    });

    await test.step('They cover all 12 matching rows, not the 10 loaded', async () => {
      await expect(screen.rows()).toHaveCount(10);
      await expect(screen.totalsOf(name.id)).toContainText(/\b12\b/);
      await expect(screen.totalsOf(hours.id)).toContainText('12,340');
      await expect(screen.totalsOf(reviewed.id)).toContainText('33.3%');
      await expect(screen.totalsOf(notes.id)).toContainText('58.3%');
      await expect(screen.totalsOf(due.id)).toContainText('Oct 5, 2026');
    });

    await test.step('They are saved with the view and survive a reload', async () => {
      await expect(async () => {
        await page.reload();
        await expect(screen.totalsOf(hours.id)).toContainText('12,340', { timeout: 2_000 });
      }).toPass();
      await expect(screen.totalsOf(name.id)).toContainText(/\b12\b/);
      await expect(screen.totalsOf(notes.id)).toContainText('58.3%');
    });

    await test.step('Grouped by Team, each group has its own totals', async () => {
      await updateView(page, database.id, table.id, { grouping: { propertyId: team.id } });
      await page.reload();
      await expect(screen.totalsOf(name.id)).toContainText([/\b8\b/, /\b4\b/]);
      await expect(screen.totalsOf(hours.id)).toContainText(['8,000', '4,340']);
      await expect(screen.totalsOf(reviewed.id)).toContainText(['25%', '50%']);
      await expect(screen.totalsOf(notes.id)).toContainText(['62.5%', '50%']);
      await expect(screen.totalsOf(due.id)).toContainText(['Oct 5, 2026', 'Oct 12, 2026']);
    });

    await test.step('Average per group: 1,000 and 1,085', async () => {
      await screen.calculate(hours.id, 'Average');
      await expect(screen.totalsOf(hours.id)).toContainText(['1,000', '1,085']);
    });
  });
});
