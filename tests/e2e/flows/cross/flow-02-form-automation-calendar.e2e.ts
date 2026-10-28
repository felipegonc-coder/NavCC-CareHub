import type { Locator, Page } from '@playwright/test';
import {
  DEFAULT_TIME_ZONE,
  apiFor,
  expect,
  needs,
  onlyIn,
  shownTime,
  signInAs,
  test,
  uniqueName,
  userIdOf,
} from '../_support/index.js';
import { AutomationEditor } from '../automations/automation-editor.js';
import { CareHubChat } from '../comments/care-hub-chat.js';
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
  const popup = page.getByRole('dialog').or(page.getByRole('menu')).or(page.getByRole('listbox'));
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
    return this.page.getByRole('button', named).or(this.page.getByRole('link', named)).first();
  }
}

// FLOW-02 (Specs, cross-area flows): Riley submits the Callback request form; an automation
// messages the new row's owner; Callbacks is a database layer in Calendar. → One new row, one 🔔
// message within 10 seconds, and the callback on the calendar at its date and time (FM-02, AU-12,
// CA-04). Riley isn't a seeded person: Val (Viewer) answers for her and names Eli (Editor) as the
// row's owner, in a Person question. Avery (Admin) makes the database, the form and, on screen,
// the automation. The callback is late tonight in Denver, when the date in UTC is already
// tomorrow, and Eli's calendar shows it on tonight's Denver date at its Denver time.
test.describe('Form response → automation → calendar', () => {
  onlyIn('desktop-light');
  needs(
    'signIn',
    'pages',
    'databases',
    'forms',
    'automations',
    'notices',
    'calendar',
    'liveUpdates',
  );

  test('FLOW-02 a Callback request makes one row, one 🔔 message to its owner within 10 seconds, and a calendar item at its time', async ({
    page,
    browser,
  }) => {
    test.slow();
    await signInAs(page, 'admin');
    const database = await makeDatabase(page, uniqueName('Fictional QA Callbacks'));
    const name = nameOf(database);
    const reason = await addProperty(page, database.id, 'Reason', config.text());
    const callbackAt = await addProperty(page, database.id, 'Callback at', config.date());
    const owner = await addProperty(page, database.id, 'Owner', config.person());
    const form = await makeForm(
      page,
      database,
      [
        question(name.id, 'Your name', { required: true }),
        question(reason.id, 'What is it about?'),
        question(callbackAt.id, 'When should we call you?', { required: true }),
        question(owner.id, 'Who should call you back?', { required: true }),
      ],
      { title: uniqueName('Fictional QA Callback request') },
    );
    const screen = new DatabaseScreen(page, database.id);
    const automation = uniqueName('Fictional QA callback alert');
    const note = uniqueName('Fictional QA callback to make');
    const caller = uniqueName('Fictional QA caller');
    const late = lateTonight();
    const eli = await signedInPage(browser, 'editor');
    // Val stands in for Riley (spec); any member who can submit the form gives the same result.
    const riley = await signedInPage(browser, 'viewer');
    const chat = new CareHubChat(eli);
    const calendar = new CalendarScreen(eli);

    try {
      await test.step('Avery: ⚡ → New automation, Form response → Send a message to Owner', async () => {
        await screen.open();
        const editor = await AutomationEditor.newFor(screen);
        await editor.name().fill(automation);
        await editor.pick('Trigger', 'Form response');
        await editor.pick('Form', form.form.title);
        await editor.addAction('Send a message');
        await editor.sendTo('Owner');
        await editor.message().fill(note);
        await editor.save();
        await expect(editor.readback()).toContainText(/message/i);
        await expect(editor.readback()).toContainText('Owner');
      });

      await test.step('Eli opens the 🔔 chat: no message yet', async () => {
        await chat.open();
        await expect(chat.shown(note)).toHaveCount(0);
      });

      await test.step('Riley sends the Callback request: late tonight, Denver time, Eli as owner', async () => {
        const response = await sendAnswers(riley, form.form.linkCode, {
          [name.id]: caller,
          [reason.id]: value.text('Fictional QA question about a bill'),
          [callbackAt.id]: { start: late.toISOString(), end: null, hasTime: true },
          // Eli is the new row's owner (the spec names none); any member picked gets the message.
          [owner.id]: [await userIdOf(eli)],
        });
        expect(response.ok()).toBe(true);
      });

      await test.step('Within 10 seconds, one 🔔 message from the automation reaches Eli', async () => {
        // 10 seconds for the automation to act, plus 2 for the open chat's live update.
        await expect(chat.shown(note)).toHaveCount(1, { timeout: 12_000 });
        // It comes from "Automation:" and the automation's name (Automations spec, Message).
        const sender = new RegExp(`Automation:\\s*${containing(automation).source}`);
        await expect(chat.shown(note).filter({ hasText: sender })).toHaveCount(1);
      });

      await test.step('The database has one new row, the callback', async () => {
        await screen.open();
        await expect(screen.rows()).toHaveText([containing(caller)]);
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

      await test.step("Still one message; Riley can't change the row she sent (403)", async () => {
        await chat.open();
        await expect(chat.shown(note)).toHaveCount(1);
        const rowId = await screen.rows().first().getAttribute('data-row-id');
        const refused = await (
          await apiFor(riley)
        ).send('PATCH', `/api/databases/${database.id}/rows/${rowId ?? ''}`, {
          values: { [reason.id]: value.text('Fictional QA change') },
        });
        expect(refused.status()).toBe(403);
      });
    } finally {
      await eli.context().close();
      await riley.context().close();
    }
  });
});
