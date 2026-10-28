import {
  apiFor,
  expect,
  needs,
  onlyIn,
  sendAgainAs,
  signInAs,
  test,
  uniqueName,
} from '../_support/index.js';
import { CareHubChat } from '../comments/care-hub-chat.js';
import { containing, signedInPage } from '../databases/database-page.js';
import { FORBIDDEN, nextWeekdayNine, TRIGGERED_MS, weekdayNudge } from './automation-data.js';
import { AutomationList } from './automation-list.js';

// Scheduled automations (Automations spec: Schedule, Message and Try it now in section 3).

/** How a run of Try it now → Send only to me is marked in the 🔔 chat. */
const TEST_MARK = /\btest\b/i;

/** Live updates reach an open screen within 2 seconds. */
const LIVE_MS = 2_000;

/** The notices in `chat` that show `note` and come from "Automation:" and the automation's name. */
function fromAutomation(chat: CareHubChat, note: string, name: string) {
  const sender = new RegExp(`Automation:\\s*${containing(name).source}`);
  return chat.shown(note).filter({ hasText: sender });
}

onlyIn('desktop-light');

test.describe('Automations on a schedule', () => {
  needs('signIn', 'automations', 'notices');

  test.describe('with live updates', () => {
    // The open 🔔 chats show what Try it now sends without a reload (#288).
    needs('liveUpdates');

    test('AU-04 Send only to me reaches only the creator, marked Test; Send to everyone now reaches all recipients', async ({
      page,
      browser,
    }) => {
      test.setTimeout(60_000);
      await signInAs(page, 'admin');
      const name = uniqueName('Weekday stand-up nudge');
      const note = uniqueName('Fictional QA stand-up: the huddle is in the General space');
      const { editor } = await weekdayNudge(page, name, note);
      const mine = new CareHubChat(await page.context().newPage());
      // Eli, of the role Editor, stands in for an Agent (spec); any member of the role gives the same result.
      const eli = await signedInPage(browser, 'editor');
      const his = new CareHubChat(eli);
      try {
        await mine.open();
        await his.open();

        await test.step('Send only to me: only Avery gets it, marked Test', async () => {
          await editor.tryItNow('Send only to me');
          await expect(mine.shown(note)).toHaveCount(1, { timeout: TRIGGERED_MS });
          await expect(mine.shown(note)).toContainText(TEST_MARK);
          await expect(fromAutomation(mine, note, name)).toHaveCount(1);
          await eli.waitForTimeout(LIVE_MS);
          await expect(his.shown(note)).toHaveCount(0);
        });

        await test.step('Send to everyone now: Eli, of the role, gets it once, not marked Test', async () => {
          await editor.tryItNow('Send to everyone now');
          await expect(his.shown(note)).toHaveCount(1, { timeout: TRIGGERED_MS });
          await expect(his.shown(note)).not.toContainText(TEST_MARK);
          await expect(fromAutomation(his, note, name)).toHaveCount(1);
        });
      } finally {
        await eli.context().close();
      }
    });
  });

  test('AU-01 Weekday stand-up nudge, left on, is planned for the next weekday at 9:00 AM', async ({
    page,
  }) => {
    await signInAs(page, 'admin');
    const name = uniqueName('Weekday stand-up nudge');
    await weekdayNudge(page, name, uniqueName('Fictional QA stand-up: huddle at 9:15'));
    const list = new AutomationList(page);
    await list.open();
    await list.switchOf(name).check();
    await expect(list.switchOf(name)).toBeChecked();
    await expect(list.entry(name)).toContainText('Weekdays at 9:00 AM');
    // Next run: today if it's a weekday before 9:00 AM in Denver, else the next Monday to Friday.
    await expect(list.entry(name)).toContainText(nextWeekdayNine(new Date()));
  });

  test('AU-09 Eli, not an Admin, has no Automations, and his direct requests are refused (403)', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'admin');
    const name = uniqueName('Weekday stand-up nudge');
    const { saved } = await weekdayNudge(page, name, uniqueName('Fictional QA stand-up'));
    // Eli stands in for Sam (spec); any member who isn't an Admin gives the same result.
    const eli = await signedInPage(browser, 'editor');
    try {
      await eli.goto('/automations');
      await expect(eli.getByRole('main')).toBeVisible();
      await expect(new AutomationList(eli).newButton()).toHaveCount(0);
      await expect(eli.getByText(name)).toHaveCount(0);
      await expect(eli.getByRole('link', { name: 'Automations', exact: true })).toHaveCount(0);

      const list = await (await apiFor(eli)).send('GET', new URL(saved.url()).pathname);
      expect(list.status()).toBe(403);
      const made = await sendAgainAs(eli, saved);
      expect(made.status()).toBe(403);
      expect(await made.json()).toEqual(FORBIDDEN);
    } finally {
      await eli.context().close();
    }
  });
});
