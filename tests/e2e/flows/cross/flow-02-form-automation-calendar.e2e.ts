import type { Locator, Page } from '@playwright/test';
import {
  DEFAULT_TIME_ZONE,
  expect,
  needs,
  onlyIn,
  shownTime,
  signInAs,
  test,
  uniqueName,
} from '../_support/index.js';
import { AutomationEditor } from '../automations/automation-editor.js';
import { addProperty, config, makeDatabase, nameOf, value } from '../databases/database-api.js';
import { containing, DatabaseScreen, signedInPage } from '../databases/database-page.js';
import { makeForm, question, sendAnswers } from '../forms/form-data.js';

/**
 * 5:30 AM UTC on the day after today in Denver: 11:30 PM tonight in Denver (10:30 PM in winter),
 * when the date in UTC is already tomorrow.
 */
function lateTonight(): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day') + 1, 5, 30));
}

/** An item's day as a screen reader hears it (Calendar spec section 6): "Tuesday, October 27". */
function spokenDay(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_TIME_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/** A pattern for these texts in this order, with any kind of space between words. */
function inOrder(...texts: string[]): RegExp {
  const patterns = texts.map((text) => containing(text).source.replace(/\s+/g, '\\s+'));
  return new RegExp(patterns.join('.*'));
}

/** A choice in the dialog, menu or list that just opened, by its name. */
function choice(page: Page, name: string | RegExp): Locator {
  const named = { name, exact: true };
  const popup = page
    .getByRole('dialog')
    .or(page.getByRole('menu'))
    .or(page.getByRole('listbox'));
  return popup
    .getByRole('menuitem', named)
    .or(popup.getByRole('option', named))
    .or(popup.getByRole('button', named))
    .first();
}

/**
 * Calendar (Calendar spec section 2), full screen from the sidebar: Today, ‹ › and Day / Week /
 * Month in the top bar, and Layers with Add layer on the left. Items show the row's title, and a
 * screen reader hears each one in full: title, day, time and layer (section 6).
 */
class CalendarScreen {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Opens Calendar from the sidebar. */
  async open(): Promise<void> {
    await this.page.goto('/');
    await this.page.getByRole('link', { name: 'Calendar', exact: true }).first().click();
    await expect(this.control('Today')).toBeVisible();
  }

  /** Today, Day, Week or Month in the top bar. */
  control(name: string): Locator {
    const named = { name, exact: true };
    return this.page
      .getByRole('button', named)
      .or(this.page.getByRole('radio', named))
      .or(this.page.getByRole('tab', named))
      .first();
  }

  /** Layers → Add layer → a database → one of its date properties (then Add, if it asks). */
  async addLayer(database: string, dateProperty: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Add layer', exact: true }).click();
    await choice(this.page, containing(database)).click();
    await choice(this.page, dateProperty).click();
    const dialog = this.page.getByRole('dialog');
    const done = dialog.getByRole('button', { name: /^(Add|Add layer|Done)$/ }).first();
    if (await done.isVisible()) await done.click();
  }

  /** An item, by the title of its row. */
  item(title: string): Locator {
    const named = { name: containing(title) };
    return this.page
      .getByRole('button', named)
      .or(this.page.getByRole('link', named))
      .first();
  }
}

// FLOW-02 (Testing lane): database → form → automation → calendar. Avery (Admin) makes a callbacks
// database with a form, and an automation that marks each response Scheduled. Eli (Editor) answers
// with a callback late tonight in Denver, when the date in UTC is already tomorrow. The automation
// acts on the new row within 10 seconds (Automations spec section 3, Running), and Eli's calendar
// shows the row on tonight's Denver date at its Denver time (Calendar spec: times are stored as
// exact moments and shown in the viewer's time zone).
test.describe('Form answer → automation → calendar', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'databases', 'forms', 'automations', 'calendar');

  test('FLOW-02 a form answer, acted on, shows on the calendar', async ({ page, browser }) => {
    test.slow();
    await signInAs(page, 'admin');
    const database = await makeDatabase(page, uniqueName('Fictional QA Callbacks'));
    const name = nameOf(database);
    const reason = await addProperty(page, database.id, 'Reason', config.text());
    const callbackAt = await addProperty(page, database.id, 'Callback at', config.date());
    await addProperty(page, database.id, 'Stage', config.select('New', 'Scheduled'));
    const form = await makeForm(page, database, [
      question(name.id, 'Your name', { required: true }),
      question(reason.id, 'What is it about?'),
      question(callbackAt.id, 'When should we call you?', { required: true }),
    ]);
    const screen = new DatabaseScreen(page, database.id);
    const automation = uniqueName('Fictional QA automation');
    const caller = uniqueName('Fictional QA caller');
    const late = lateTonight();
    const eli = await signedInPage(browser, 'editor');
    const calendar = new CalendarScreen(eli);

    await test.step('Avery: ⚡ → New automation, Form response → Edit the row', async () => {
      await screen.open();
      const editor = await AutomationEditor.newFor(screen);
      await editor.name().fill(automation);
      await editor.pick('Trigger', 'Form response');
      await editor.pick('Form', form.name);
      await editor.addAction('Edit the row');
      await editor.pick('Property', 'Stage');
      await editor.pick('Value', 'Scheduled');
      await editor.save();
      await expect(editor.readback()).toContainText(/set Stage to Scheduled/i);
      await editor.runHistory();
      await expect(page.getByText("Hasn't run yet.")).toBeVisible();
    });

    await test.step('Eli answers: call me back late tonight, Denver time', async () => {
      const response = await sendAnswers(eli, form.form.linkCode, {
        [name.id]: value.text(caller),
        [reason.id]: value.text('Fictional QA question about a bill'),
        [callbackAt.id]: { start: late.toISOString(), end: null, hasTime: true },
      });
      expect(response.ok()).toBe(true);
    });

    await test.step('Within 10 seconds the new row is Scheduled', async () => {
      // Reloads the table until the row shows it, so the time includes loading the table.
      await expect(async () => {
        await screen.open();
        await expect(screen.row(caller)).toContainText('Scheduled', { timeout: 1_000 });
      }).toPass({ timeout: 12_000 });
    });

    await test.step('Run history lists the run', async () => {
      const editor = await AutomationEditor.openFor(screen, automation);
      await editor.runHistory();
      await expect(page.getByText("Hasn't run yet.")).toBeHidden();
      const run = page.getByText(containing(caller)).or(page.getByText(/triggered/i));
      await expect(run.first()).toBeVisible();
    });

    await test.step('Eli: Calendar → Add layer → the database → Callback at', async () => {
      await calendar.open();
      await calendar.addLayer(database.title, 'Callback at');
    });

    await test.step("Today's Day view has it, heard with its Denver date and time", async () => {
      await calendar.control('Day').click();
      await calendar.control('Today').click();
      const item = calendar.item(caller);
      await expect(item).toBeVisible();
      await expect(item).toHaveAccessibleName(inOrder(caller, spokenDay(late), shownTime(late)));
    });

    await test.step('Its panel shows Callback at and Open row', async () => {
      await calendar.item(caller).click();
      await expect(eli.getByText('Callback at').first()).toBeVisible();
      const open = { name: 'Open row', exact: true };
      await expect(eli.getByRole('button', open).or(eli.getByRole('link', open))).toBeVisible();
    });
    await eli.context().close();
  });
});
