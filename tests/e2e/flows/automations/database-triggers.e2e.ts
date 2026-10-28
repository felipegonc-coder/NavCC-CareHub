import type { Page } from '@playwright/test';
import {
  expect,
  needs,
  onlyIn,
  people,
  sendAgainAs,
  signInAs,
  test,
  uniqueName,
  userIdOf,
} from '../_support/index.js';
import { CareHubChat } from '../comments/care-hub-chat.js';
import {
  addProperty,
  addRow,
  config,
  makeDatabase,
  optionId,
  updateRow,
} from '../databases/database-api.js';
import { DatabaseScreen, signedInPage } from '../databases/database-page.js';
import { FORBIDDEN, importRows, SETTLE_MS, TRIGGERED_MS } from './automation-data.js';
import { AutomationEditor } from './automation-editor.js';

// Automations that database changes start (Automations spec section 3, Triggers), made by Avery
// (Admin) from ⚡ in the database's toolbar. Eli gets their messages in his 🔔 Care Hub chat.

/** A CSV of 20 fictional QA reviews, each with Eli as Team lead (matched by his email). */
function reviews(batch: string): string[][] {
  const rows = Array.from({ length: 20 }, (_, i) => [
    `QA review – Fictional caller ${batch}${i + 1}`,
    people.editor.email,
  ]);
  return [['Name', 'Team lead'], ...rows];
}

/**
 * Tickets with Status (Open, Escalated, Done) and one open ticket, plus "Status changes to
 * Escalated → message Eli", which Avery makes from ⚡.
 */
async function escalations(page: Page) {
  await signInAs(page, 'admin');
  const database = await makeDatabase(page, uniqueName('Tickets'));
  const status = await addProperty(
    page,
    database.id,
    'Status',
    config.status(['Open', 'todo'], ['Escalated', 'in_progress'], ['Done', 'complete']),
  );
  const ticket = await addRow(page, database.id, 'Fictional ticket: callback about a bill', {
    [status.id]: optionId(status, 'Open'),
  });
  const screen = new DatabaseScreen(page, database.id);
  await screen.open();
  const note = uniqueName('Fictional QA ticket escalated');
  const editor = await AutomationEditor.newFor(screen);
  await editor.name().fill(uniqueName('Status changes to Escalated'));
  await editor.pick('Trigger', 'Property changed');
  await editor.watch('Status', 'Escalated');
  await editor.addAction('Send a message');
  await editor.sendTo('Eli');
  await editor.message().fill(note);
  const saved = await editor.save();
  await expect(editor.readback()).toContainText('When Status changes to Escalated');
  /** Avery sets the ticket's Status. */
  const setStatus = (option: string) =>
    updateRow(page, database.id, ticket.id, { [status.id]: optionId(status, option) });
  return { database, note, saved, setStatus };
}

onlyIn('desktop-light');

test.describe('Automations on database changes', () => {
  needs('signIn', 'pages', 'databases', 'automations', 'notices');

  test.describe('with live updates', () => {
    // The open 🔔 chat shows what the triggers send without a reload (#288).
    needs('liveUpdates');

    test.describe('with CSV import', () => {
      needs('databaseCsv');

      test('AU-12 Row added to QA reviews messages the row’s Team lead within 10 seconds; a CSV import fires nothing unless Include imports is on', async ({
        page,
        browser,
      }) => {
        test.setTimeout(150_000);
        await signInAs(page, 'admin');
        const database = await makeDatabase(page, uniqueName('QA reviews'));
        const teamLead = await addProperty(page, database.id, 'Team lead', config.person());
        const screen = new DatabaseScreen(page, database.id);
        const name = uniqueName('Row added to QA reviews');
        const note = uniqueName('Fictional QA review waiting for you');
        const eli = await signedInPage(browser, 'editor');
        const chat = new CareHubChat(eli);
        try {
          await test.step('Avery makes Row added → message the row’s Team lead, from ⚡', async () => {
            await screen.open();
            const editor = await AutomationEditor.newFor(screen);
            await editor.name().fill(name);
            await editor.pick('Trigger', 'Row added');
            await expect(editor.option('Include imports')).not.toBeChecked();
            await editor.addAction('Send a message');
            await editor.sendTo('Team lead');
            await editor.message().fill(note);
            await editor.save();
            await expect(editor.readback()).toContainText(
              `When a row is added to ${database.title}`,
            );
          });

          await test.step('A row with Eli as Team lead reaches him within 10 seconds', async () => {
            await chat.open();
            await addRow(page, database.id, 'QA review – Fictional Blue Pine call', {
              [teamLead.id]: [await userIdOf(eli)],
            });
            await expect(chat.shown(note)).toHaveCount(1, { timeout: TRIGGERED_MS });
          });

          await test.step('A CSV import of 20 rows sends nothing', async () => {
            await screen.open();
            await importRows(screen, reviews('A'));
            await eli.waitForTimeout(TRIGGERED_MS);
            await expect(chat.shown(note)).toHaveCount(1);
          });

          await test.step('With Include imports on, an import of 20 rows sends 20', async () => {
            await screen.open();
            const editor = await AutomationEditor.openFor(screen, name);
            await editor.option('Include imports').check();
            await editor.save();
            await screen.open();
            await importRows(screen, reviews('B'));
            await expect(chat.shown(note)).toHaveCount(21, { timeout: TRIGGERED_MS });
          });
        } finally {
          await eli.context().close();
        }
      });
    });

    test('AU-13 Status changes to Escalated fires once, for Escalated only', async ({
      page,
      browser,
    }) => {
      test.setTimeout(90_000);
      const { note, setStatus } = await escalations(page);
      const eli = await signedInPage(browser, 'editor');
      const chat = new CareHubChat(eli);
      try {
        await chat.open();
        await test.step('Open → Escalated: Eli gets one message', async () => {
          await setStatus('Escalated');
          await expect(chat.shown(note)).toHaveCount(1, { timeout: SETTLE_MS + TRIGGERED_MS });
        });
        await test.step('Escalated → Open, a change of its own: nothing more', async () => {
          await setStatus('Open');
          await eli.waitForTimeout(SETTLE_MS + TRIGGERED_MS);
          await expect(chat.shown(note)).toHaveCount(1);
        });
      } finally {
        await eli.context().close();
      }
    });

    test('AU-13 three edits 2 seconds apart make one check, 5 seconds after the first, with the latest values', async ({
      page,
      browser,
    }) => {
      test.setTimeout(120_000);
      const { note, setStatus } = await escalations(page);
      /** Status edits 2 seconds apart, the last one 4 seconds after the first. */
      const burst = async (...options: string[]) => {
        const start = Date.now();
        for (const [i, option] of options.entries()) {
          await page.waitForTimeout(Math.max(0, start + i * 2_000 - Date.now()));
          await setStatus(option);
        }
      };
      const eli = await signedInPage(browser, 'editor');
      const chat = new CareHubChat(eli);
      try {
        await chat.open();
        await test.step('Escalated, Done, Open: back to how it was, so nothing fires', async () => {
          await burst('Escalated', 'Done', 'Open');
          await eli.waitForTimeout(SETTLE_MS + TRIGGERED_MS);
          await expect(chat.shown(note)).toHaveCount(0);
        });
        await test.step('Done, Open, Escalated: one message, for the latest value', async () => {
          await burst('Done', 'Open', 'Escalated');
          await expect(chat.shown(note)).toHaveCount(1, { timeout: SETTLE_MS + TRIGGERED_MS });
        });
      } finally {
        await eli.context().close();
      }
    });
  });

  test('AU-09 Eli, not an Admin, has no ⚡ in the toolbar, and his direct request is refused (403)', async ({
    page,
    browser,
  }) => {
    const { database, saved } = await escalations(page);
    // Eli stands in for Sam (spec); any member who isn't an Admin gives the same result.
    const eli = await signedInPage(browser, 'editor');
    try {
      const screen = new DatabaseScreen(eli, database.id);
      await screen.open();
      await expect(screen.root.getByRole('button', { name: /^(⚡|Automations)/ })).toHaveCount(0);
      const refused = await sendAgainAs(eli, saved);
      expect(refused.status()).toBe(403);
      expect(await refused.json()).toEqual(FORBIDDEN);
    } finally {
      await eli.context().close();
    }
  });
});
