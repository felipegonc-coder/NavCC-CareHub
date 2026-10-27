import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import {
  addProperty,
  addRow,
  config,
  makeDatabase,
  updateRow,
  value,
} from '../databases/database-api.js';
import { DatabaseScreen, signedInPage } from '../databases/database-page.js';
import { formula, prop } from './formula-data.js';
import { FormulaEditor } from './formula-editor.js';

// Formulas spec: FX-02 and FX-04. Sam, who changes the Score in FX-02, isn't a seeded person:
// Avery (the seeded admin) stands in for him.

test.describe('Formulas: live results and the editor', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'databases', 'formulas');

  test.describe('with live updates', () => {
    needs('liveUpdates');

    test('FX-02 if(prop("Score") >= 90, "Pass", "Review") shows Review, then Pass within 2 seconds of Sam changing Score', async ({
      page,
      browser,
    }) => {
      await signInAs(page, 'editor');
      const database = await makeDatabase(page);
      const score = await addProperty(page, database.id, 'Score', config.number());
      const result = await addProperty(
        page,
        database.id,
        'Result',
        formula(`if(${prop(score)} >= 90, "Pass", "Review")`, 'text'),
      );
      const row = await addRow(page, database.id, uniqueName('Fictional QA review Blue Pine'), {
        [score.id]: value.number(85),
      });
      // Avery stands in for Sam (spec); any member who can edit gives the same result.
      const sam = await signedInPage(browser, 'admin');
      try {
        const screen = new DatabaseScreen(page, database.id);
        await screen.open();
        await expect(screen.cell(row.id, result.id)).toHaveText('Review');

        await updateRow(sam, database.id, row.id, { [score.id]: value.number(95) });
        await expect(screen.cell(row.id, result.id)).toHaveText('Pass', { timeout: 2_000 });
        await expect(screen.cell(row.id, score.id)).toHaveText('95');
      } finally {
        await sam.context().close();
      }
    });
  });

  test('FX-04 a missing bracket shows its line and message, Text + Number suggests format(), and Done stays off until it is fixed', async ({
    page,
  }) => {
    await signInAs(page, 'editor');
    const database = await makeDatabase(page);
    const score = await addProperty(page, database.id, 'Score', config.number());
    const result = await addProperty(page, database.id, 'Result', formula(prop(score), 'number'));
    const row = await addRow(page, database.id, uniqueName('Fictional QA review Blue Pine'), {
      [score.id]: value.number(85),
    });
    const screen = new DatabaseScreen(page, database.id);
    await screen.open();
    const editor = await FormulaEditor.fromCell(screen, row.id, result.id);
    await expect(editor.says('Number · 85')).toBeVisible();

    await test.step("A missing ')' at the end of line 2", async () => {
      await editor.write('if(prop("Score") >= 90,\n  "Pass", "Review"');
      await expect(editor.says(/Missing '\)' at line 2/)).toBeVisible();
      await expect(editor.done).toBeDisabled();
    });

    await test.step('Text + Number', async () => {
      await editor.write('"Score: " + prop("Score")');
      await expect(
        editor.says("Text and a number can't be added. Use format() to make the number text."),
      ).toBeVisible();
      await expect(editor.done).toBeDisabled();
    });

    await test.step('With the bracket in place, the result shows and Done saves it', async () => {
      await editor.write('if(prop("Score") >= 90,\n  "Pass", "Review")');
      await expect(editor.says('Text · Review')).toBeVisible();
      await expect(editor.done).toBeEnabled();
      await editor.done.click();
      await expect(editor.dialog).toBeHidden();
      await expect(screen.cell(row.id, result.id)).toHaveText('Review');
    });
  });

  test("FX-04 a viewer can't change a formula: the server refuses it (403)", async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'editor');
    const database = await makeDatabase(page);
    const score = await addProperty(page, database.id, 'Score', config.number());
    const result = await addProperty(page, database.id, 'Result', formula(prop(score), 'number'));
    const viewer = await signedInPage(browser, 'viewer');
    try {
      const api = await apiFor(viewer);
      // The viewer can read the database, so she sends its current version, as the screens would.
      const meta = await api.get<{ version?: unknown; database?: { version?: unknown } }>(
        `/api/databases/${database.id}`,
      );

      const refused = await api.send(
        'PATCH',
        `/api/databases/${database.id}/properties/${result.id}`,
        {
          config: formula(`${prop(score)} * 2`, 'number'),
          version: meta.database?.version ?? meta.version,
        },
      );
      expect(refused.status()).toBe(403);
      expect(await refused.json()).toMatchObject({ error: { code: 'forbidden' } });
    } finally {
      await viewer.context().close();
    }
  });
});
