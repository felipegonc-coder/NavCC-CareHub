import type { Request } from '@playwright/test';
import {
  expect,
  needs,
  onlyIn,
  sendAgainAs,
  signInAs,
  test,
  uniqueName,
  userIdOf,
} from '../_support/index.js';
import { AutomationEditor } from '../automations/automation-editor.js';
import { CareHubChat } from '../comments/care-hub-chat.js';
import { addProperty, config, makeDatabase, optionId } from '../databases/database-api.js';
import { DatabaseScreen, signedInPage } from '../databases/database-page.js';
import { Editor } from '../editor/editor-page.js';
import { makePage } from '../pages/page-data.js';
import { FORBIDDEN, PageScreen, literally } from '../pages/page-screen.js';
import { nameOf } from '../sharing/share-dialog.js';
import { ButtonSettings, addRowTemplate, undoOf } from '../templates/templates-page.js';

/** Database triggers start their actions within 10 seconds; the open chat shows them within 2. */
const TRIGGERED_MS = 12_000;

// FLOW-06 (Specs, cross-area flows): on the page QA desk, Avery clicks the button New QA review,
// which adds a row to QA reviews from its template, while "Row added to QA reviews → message the
// row's Team lead" is on. → One new row with the template filled in, and the Team lead gets a 🔔
// message within 10 seconds (TB-09, AU-12). Avery (Admin) sets up the database, its template, the
// automation and the button. The last step adds the Templates and buttons rules for someone with
// Can view: the button is greyed out, "Only people who can edit this page" (section 2), and a
// direct request to run it is refused (403) before anything changes (section 5).
test.describe('Button → row → automation → message', () => {
  onlyIn('desktop-light');
  needs(
    'signIn',
    'pages',
    'editor',
    'slashMenu',
    'databases',
    'templates',
    'automations',
    'notices',
    // The automation runs as a job, and the open 🔔 chat shows its message without a reload.
    'liveUpdates',
  );

  test('FLOW-06 New QA review on QA desk adds one row from its template, and the Team lead gets one 🔔 message within 10 seconds', async ({
    page,
    browser,
  }) => {
    test.slow();
    await signInAs(page, 'admin');
    const reviews = await makeDatabase(page, uniqueName('Fictional QA reviews'));
    const teamLead = await addProperty(page, reviews.id, 'Team lead', config.person());
    const queue = await addProperty(page, reviews.id, 'Queue', config.select('Billing', 'Visits'));
    const desk = await makePage(page, uniqueName('Fictional QA desk'));
    const automation = uniqueName('Fictional QA row added to QA reviews');
    const note = uniqueName('Fictional QA review for its Team lead');
    const label = 'New QA review';
    const table = new DatabaseScreen(page, reviews.id);
    const editor = new Editor(page);
    const settings = new ButtonSettings(page);
    const button = editor.screen.main.getByRole('button', { name: label });
    // Eli is the Team lead (the spec names none); any member the template names gets the message.
    const eli = await signedInPage(browser, 'editor');
    // Val (Viewer) can only view QA desk; anyone with Can view on it gives the same result.
    const val = await signedInPage(browser, 'viewer');
    const chat = new CareHubChat(eli);

    try {
      const template = await addRowTemplate(page, reviews.id, 'Fictional QA review', {
        [teamLead.id]: [await userIdOf(eli)],
        [queue.id]: optionId(queue, 'Billing'),
      });

      await test.step('Avery: ⚡ → New automation, Row added → Send a message to Team lead', async () => {
        await table.open();
        const automations = await AutomationEditor.newFor(table);
        await automations.name().fill(automation);
        await automations.pick('Trigger', 'Row added');
        await automations.addAction('Send a message');
        await automations.sendTo('Team lead');
        await automations.message().fill(note);
        await automations.save();
      });

      await test.step('Avery: "/button" on QA desk → New QA review, Add a row from the template', async () => {
        await editor.screen.goto(desk);
        await editor.screen.title.click();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await expect(editor.content).toBeFocused();
        await page.keyboard.type('/button');
        await editor.option('Button').click();
        await expect(settings.dialog).toBeVisible();
        await settings.label.fill(label);
        const adding = await settings.addAction('Add a row');
        await settings.choose(adding, /database/i, literally(reviews.title));
        await settings.choose(adding, /template/i, literally(template.name));
        await expect(settings.sentence).toContainText(reviews.title);
        await settings.done();
        await expect(button).toBeVisible();
      });

      await test.step('Eli opens the 🔔 chat: no message yet', async () => {
        await chat.open();
        await expect(chat.shown(note)).toHaveCount(0);
      });

      let press: Request | undefined;
      await test.step('Avery presses New QA review: Done, with Undo', async () => {
        const pressed = page.waitForRequest(
          (request) =>
            request.method() === 'POST' && /\/api\/\S*(rows|button|press)/.test(request.url()),
        );
        await button.click();
        press = await pressed;
        await expect(undoOf(page)).toBeVisible();
      });

      await test.step('Within 10 seconds, one 🔔 message from the automation reaches Eli', async () => {
        await expect(chat.shown(note)).toHaveCount(1, { timeout: TRIGGERED_MS });
        // It comes from "Automation:" and the automation's name (Automations spec, Message).
        const sender = new RegExp(`Automation:\\s*${literally(automation).source}`);
        await expect(chat.shown(note).filter({ hasText: sender })).toHaveCount(1);
      });

      await test.step('QA reviews has one new row, with the template filled in', async () => {
        await table.open();
        await expect(table.rows()).toHaveCount(1);
        await expect(table.rows().first()).toContainText('Billing');
        await expect(table.rows().first()).toContainText(await nameOf(eli));
      });

      await test.step('Val, who can only view QA desk, finds it greyed out; her press is refused (403)', async () => {
        const hers = new PageScreen(val);
        await hers.goto(desk);
        await expect(hers.viewOnly).toBeVisible();
        const greyed = hers.main.getByRole('button', { name: label });
        await expect(greyed).toBeDisabled();
        await greyed.hover();
        await expect(val.getByText('Only people who can edit this page').first()).toBeVisible();
        const refused = await sendAgainAs(val, press as Request);
        expect(refused.status()).toBe(403);
        expect(await refused.json()).toEqual(FORBIDDEN);
        await table.open();
        await expect(table.rows()).toHaveCount(1);
        await expect(chat.shown(note)).toHaveCount(1);
      });
    } finally {
      await eli.context().close();
      await val.context().close();
    }
  });
});
