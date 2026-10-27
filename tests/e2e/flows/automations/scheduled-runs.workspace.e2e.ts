import type { Page } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import { CareHubChat } from '../comments/care-hub-chat.js';
import { signedInPage } from '../databases/database-page.js';
import {
  dayName,
  firstWeekdayNine,
  isWeekday,
  throughNextWeekend,
  TRIGGERED_MS,
  wallClock,
  weekdayNudge,
} from './automation-data.js';
import { AutomationList } from './automation-list.js';

// AU-01 runs the automations' scheduler at times it picks (#361's jobs test hook), so every
// switched-on schedule in the workspace runs then too. That's why this file's name ends in
// .workspace.e2e.ts: it runs after the others, on its own.

/** The periodic task that runs scheduled automations when they're due. */
// Assumed name: the Automations lane's scheduler isn't on main yet.
const SCHEDULER = 'automations.schedule';

/** Runs the scheduler once, as if the time were `now`. Site admins only, such as Avery. */
async function runSchedulerAt(page: Page, now: Date): Promise<void> {
  const api = await apiFor(page);
  await api.post(`/api/jobs/test/periodic/${SCHEDULER}`, { now: now.toISOString() });
}

onlyIn('desktop-light');

test.describe('Automations on a schedule, by the clock', () => {
  // Live updates (#288) bring each run's message to Eli's open 🔔 chat without a reload.
  needs('signIn', 'automations', 'notices', 'liveUpdates', 'jobsTestHook');

  test('AU-01 Weekday stand-up nudge, left on, reaches each Agent at 9:00 AM Denver time, on weekdays only', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    await signInAs(page, 'admin');
    const name = uniqueName('Weekday stand-up nudge');
    const note = uniqueName('Fictional QA stand-up: the huddle is in the General space');
    await weekdayNudge(page, name, note);
    const list = new AutomationList(page);
    await list.open();
    await list.switchOf(name).check();
    await expect(list.switchOf(name)).toBeChecked();
    // Eli, of the role Editor, stands in for an Agent (spec); any member of the role gives the same result.
    const eli = await signedInPage(browser, 'editor');
    const chat = new CareHubChat(eli);
    try {
      await chat.open();
      // From the nudge's first run through the Monday after the next weekend, in Denver.
      const now = new Date();
      const first = firstWeekdayNine(now);
      const days = throughNextWeekend(now);

      await test.step(`${dayName(first)}, 8:59 AM: nothing yet`, async () => {
        await runSchedulerAt(page, wallClock(first, 8, 59, 30));
        await eli.waitForTimeout(TRIGGERED_MS);
        await expect(chat.shown(note)).toHaveCount(0);
      });

      let sent = 0;
      for (const day of days) {
        const weekday = isWeekday(day);
        await test.step(`${dayName(day)}, 9:00 AM: ${weekday ? 'one more' : 'nothing'}`, async () => {
          await runSchedulerAt(page, wallClock(day, 9, 0, 30));
          if (weekday) sent += 1;
          else await eli.waitForTimeout(TRIGGERED_MS);
          await expect(chat.shown(note)).toHaveCount(sent, { timeout: TRIGGERED_MS });
        });
      }
    } finally {
      await eli.context().close();
    }
  });
});
