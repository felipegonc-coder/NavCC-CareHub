import type { Browser, Locator, Page } from '@playwright/test';
import { expect, needs, onlyIn, people, signInAs, test, uniqueName } from '../_support/index.js';
import * as data from '../meetings/meetings-data.js';
import * as mt from '../meetings/meetings-page.js';

// Every check that reads or changes the workspace's Claude switches (Claude features, section
// 3.1) is in this one file, which runs in order, so a switch one check turns on never shows up in
// another. The checks of the default, with every switch off, come first (CL-01, MT-11). Then come
// the checks that turn a switch on: each turns it off again in `finally`, and afterAll turns every
// switch off, whatever happened.

test.describe.configure({ mode: 'serial' });

const { MINUTE } = data;

/** The four workspace switches in Settings → Claude (section 3.1). All start off. */
const SWITCHES = ['Writing help', 'Assistant', 'Claude fields', 'Meeting summary'] as const;
type Switch = (typeof SWITCHES)[number];

/** Settings → Claude (Workspace, Admins only), opened with Ctrl+, over Home. */
async function openClaudeSettings(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  await page.keyboard.press('Control+Comma');
  const exact = { name: 'Claude', exact: true };
  await page.getByRole('link', exact).or(page.getByRole('tab', exact)).first().click();
  await expect(page.getByRole('heading', exact).first()).toBeVisible();
}

/** One of the four switches in Settings → Claude. */
const claudeSwitch = (page: Page, name: Switch): Locator =>
  page.getByRole('switch', { name: new RegExp(`^${name}`) }).first();

/** Turns every Claude switch off as Avery (an Admin), in a window of its own. */
async function turnEverySwitchOff(browser: Browser): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signInAs(page, 'admin');
    await openClaudeSettings(page);
    for (const name of SWITCHES) {
      const control = claudeSwitch(page, name);
      if (!(await control.isChecked())) continue;
      await control.click();
      // Care Hub may ask before turning one off.
      const confirm = page.getByRole('alertdialog').getByRole('button', { name: /^turn off/i });
      if (
        await confirm.waitFor({ timeout: 2_000 }).then(
          () => true,
          () => false,
        )
      ) {
        await confirm.click();
      }
      await expect(control, name).not.toBeChecked();
    }
  } finally {
    await context.close();
  }
}

/** A one-hour slot on day `day` (0 is Sunday) of the week from `sunday`, at `time`. */
function slot(sunday: string, day: number, time: string) {
  const start = mt.momentAt(mt.addDays(sunday, day), time);
  return { start, end: start + 60 * MINUTE };
}

test.describe('Claude switches', () => {
  onlyIn('desktop-light');
  needs('signIn', 'claude');

  test.afterAll(async ({ browser }) => {
    await turnEverySwitchOff(browser);
  });

  // ---- With every switch off (the default). CL-01 comes first here. ----

  test.describe('Meetings with Claude off', () => {
    needs('calendar', 'meetings', 'pages');

    /** No button, link or menu item called Summarize on the screen. */
    async function expectNoSummarize(page: Page, where: string): Promise<void> {
      for (const role of ['button', 'link', 'menuitem'] as const) {
        await expect(page.getByRole(role, { name: /summari[sz]e/i }), where).toHaveCount(0);
      }
    }

    test('MT-11 with Claude off, there is no Summarize button anywhere', async ({
      page,
      browser,
    }) => {
      await signInAs(page, 'admin');
      const eli = await data.member(page, people.editor.email);
      const sunday = mt.sundayIn(10);
      const title = uniqueName('Team huddle');
      const windows: Page[] = [];
      const eventId = await data.createEvent(page, {
        title,
        ...slot(sunday, 2, '10:00'),
        people: [eli.id],
      });
      try {
        // Meeting summary starts off and only an Admin turns it on (Claude features, section 3.1).
        await test.step('not in the event panel', async () => {
          await mt.openEvent(page, title, sunday);
          await expect(mt.notesButton(page)).toBeVisible();
          await expectNoSummarize(page, 'event panel');
        });

        let notesId = '';
        await test.step('not in the notes page, for Avery (an Admin) or Eli (an Editor)', async () => {
          await mt.notesButton(page).click();
          await page.waitForURL(/\/p\/[^/?#]+/);
          notesId = mt.pageIdIn(page.url());
          await expect(mt.sectionHeading(page, 'Summary')).toBeVisible();
          await expectNoSummarize(page, "Avery's notes page");
          const eliPage = await mt.windowFor(browser, 'editor');
          windows.push(eliPage);
          await eliPage.goto(`/p/${notesId}`);
          await expect(mt.sectionHeading(eliPage, 'Summary')).toBeVisible();
          await expectNoSummarize(eliPage, "Eli's notes page");
        });

        await test.step('not in All meeting notes', async () => {
          await mt.openAllMeetingNotes(page);
          await mt.searchNotes(page, title);
          await expect(page.getByRole('main').getByText(title).first()).toBeVisible();
          await expectNoSummarize(page, 'All meeting notes');
        });
      } finally {
        await data.deleteEvent(page, eventId);
        for (const opened of windows) await opened.context().close();
      }
    });
  });

  // ---- With a switch on. Each check turns its switch off again in `finally`. ----
});
