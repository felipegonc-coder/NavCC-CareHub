import type { Locator, Page } from '@playwright/test';
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import * as data from '../calendar/calendar-data.js';
import * as cal from '../calendar/calendar-page.js';
import * as home from '../home/home-page.js';
import * as mt from '../meetings/meetings-page.js';

// FLOW-05, meeting → notes → action item → reminder: Calendar (CA-06), Home (HR-02), Meetings
// (MT-01, MT-15), Pages and blocks (dates in text, section 3.7) and Home and reminders (HR-16).
// The spec's Sam is the seeded Eli. Join on Home is worked out in the browser, so Eli's Home moves
// its clock on (page.clock) instead of waiting. The reminder comes from the server at its time,
// so that part waits for real: the date is tomorrow, and "1 day before" makes it due 2 to 3
// minutes after the slower steps are done. Times are in America/Denver; "@tomorrow" counts from
// today there, so a run just before midnight waits for the new day first.

const { MINUTE } = data;
const zoom = 'https://us02web.zoom.us/j/84455667788?pwd=fictional';

/** "3:07pm" for 15:07, the way people type a time after "@tomorrow" (Pages and blocks, 3.4). */
function typedTime(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')}${hours < 12 ? 'am' : 'pm'}`;
}

/** The time as a date chip shows it: "3:07 PM", with any kind of space before PM. */
function shownTimeOf(time: string): RegExp {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const clock = `${hours % 12 || 12}:${String(minutes).padStart(2, '0')}`;
  return new RegExp(`\\b${clock}\\s*${hours < 12 ? 'AM' : 'PM'}`, 'i');
}

/**
 * A reminder time 2 to 3 minutes from now, on today's date in America/Denver: "@tomorrow" counts
 * from today, and "1 day before" brings the reminder back to today. Just before midnight it waits
 * for the new day first, and gives the test that much more time.
 */
async function dueSoonToday(page: Page): Promise<number> {
  for (;;) {
    const now = Date.now();
    const due = Math.ceil((now + 2 * MINUTE) / MINUTE) * MINUTE;
    const { date, time } = cal.dateAndTime(due);
    if (date === cal.dateAndTime(now).date) return due;
    const [hours = 0, minutes = 0] = time.split(':').map(Number);
    const wait = due - (hours * 60 + minutes) * MINUTE - now + 5_000;
    test.setTimeout(test.info().timeout + wait);
    await page.waitForTimeout(wait);
  }
}

/** The date chip in a to-do, found by the time it shows. */
const chipIn = (todo: Locator, time: RegExp): Locator =>
  todo.getByRole('button', { name: time }).or(todo.getByText(time)).first();

/**
 * Sets a reminder on a date chip: its picker (date, time, end date and a reminder) and one of the
 * reminder choices, such as "1 day before" (Pages and blocks, section 3.7).
 */
async function remindOn(page: Page, chip: Locator, choice: string): Promise<void> {
  await chip.click();
  const picker = page.getByRole('dialog').last();
  const control = picker
    .getByRole('combobox', { name: /remind/i })
    .or(picker.getByLabel(/remind/i))
    .or(picker.getByRole('button', { name: /remind/i }))
    .first();
  if ((await control.evaluate((element) => element.tagName)) === 'SELECT') {
    await control.selectOption({ label: choice });
  } else {
    await control.click();
    const exact = { name: choice, exact: true };
    await page
      .getByRole('option', exact)
      .or(page.getByRole('menuitemradio', exact))
      .or(page.getByRole('menuitem', exact))
      .first()
      .click();
  }
  await page.keyboard.press('Escape');
}

test.describe('Cross-area flow: a meeting, its notes, an action item and its reminder', () => {
  onlyIn('desktop-light');
  needs(
    'signIn',
    'calendar',
    'meetings',
    'pages',
    'editor',
    'comments',
    'home',
    'reminders',
    'messages',
    'notices',
  );

  test('FLOW-05 Avery’s Team huddle with Eli and a Zoom link: Eli gets the invite, sees Join on Home 10 minutes before, finds "@Eli call Blue Pine Plumbing" under My action items, and gets the reminder he set on its date in 🔔 at its time', async ({
    page,
    browser,
  }) => {
    test.setTimeout(6 * MINUTE); // the reminder comes 2 to 3 minutes after the slower steps
    await signInAs(page, 'admin');
    const title = uniqueName('Team huddle');
    const tag = title.split(' ').at(-1) ?? '';
    const todoText = `call Blue Pine Plumbing ${tag}`;
    const start = Math.ceil((Date.now() + 30 * MINUTE) / (5 * MINUTE)) * 5 * MINUTE;
    const sunday = cal.sundayOf(cal.dateAndTime(start).date);
    const id = await data.createEvent(page, {
      title,
      start,
      end: start + 30 * MINUTE,
      videoUrl: zoom,
    });
    const eli = await cal.windowFor(browser, 'editor');
    const windows: Page[] = [eli];

    try {
      await test.step('Avery adds Eli in the event panel, and Eli gets the invite in 🔔', async () => {
        await cal.openCalendar(page);
        await cal.goToWeek(page, sunday);
        await cal.eventBlock(page, title).click();
        await cal.addPerson(page, 'Eli');
        await cal.openNotices(eli);
        await expect(cal.notices(eli, title, /invit|added you/i).first()).toBeVisible({
          timeout: 15_000,
        });
      });

      await test.step('Eli’s Home shows Join from 10 minutes before the start, not before', async () => {
        const homePage = await home.windowFor(browser, 'editor');
        windows.push(homePage);
        await homePage.clock.install({ time: Date.now() });
        await home.openHome(homePage);
        const item = home.itemIn(homePage, 'Upcoming', title);
        await expect(item).toBeVisible();
        await homePage.clock.pauseAt(start - 10 * MINUTE - 5_000);
        // Nothing should change yet, so give the screen a moment to go wrong.
        await homePage.waitForTimeout(500);
        await expect(home.joinIn(item), '5 seconds before').toHaveCount(0);
        await homePage.clock.runFor(MINUTE + 5_000);
        await expect(home.joinIn(item)).toBeVisible();
      });

      const { notesId, todo } =
        await test.step('Avery takes meeting notes and adds the to-do "@Eli call Blue Pine Plumbing"', async () => {
          const notes = await mt.takeNotes(page, title, sunday);
          return { notesId: notes, todo: await mt.addActionItem(page, 'Eli', todoText) };
        });

      await test.step('Eli finds the to-do under My action items, with its meeting', async () => {
        await mt.openAllMeetingNotes(eli);
        await mt.choose(eli, 'My action items');
        const main = eli.getByRole('main');
        await expect(
          main
            .getByRole('listitem')
            .or(main.getByRole('row'))
            .filter({ hasText: todoText })
            .first(),
        ).toContainText(title);
      });

      // The reminder's time, now that the slower steps are done. The date chip is a day later.
      const due = await dueSoonToday(page);
      const { date: dueDate, time } = cal.dateAndTime(due);
      const shown = shownTimeOf(time);

      await test.step('Avery gives the to-do tomorrow’s date at that time', async () => {
        await todo.getByText(tag).click();
        await page.keyboard.press('End');
        await page.keyboard.type(` @tomorrow ${typedTime(time)}`);
        const tomorrow = cal.addDays(dueDate, 1);
        const day = new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(`${tomorrow}T12:00:00Z`));
        await page
          .getByRole('option', { name: new RegExp(`tomorrow|${cal.escape(day)}`, 'i') })
          .first()
          .click();
        await expect(chipIn(todo, shown)).toBeVisible();
      });

      await test.step('Eli adds a reminder "1 day before" to that date; the chip shows ⏰', async () => {
        await eli.goto(`/p/${notesId}`);
        const eliTodo = mt.todoWith(eli, todoText);
        await expect(chipIn(eliTodo, shown)).toBeVisible();
        await remindOn(eli, chipIn(eliTodo, shown), '1 day before');
        await expect(chipIn(eliTodo, shown)).toContainText('⏰');
      });

      await test.step('the reminder arrives in Eli’s 🔔 chat within a minute of its time', async () => {
        await home.openNotices(eli);
        expect(Date.now(), 'Eli has 🔔 open before the reminder’s time').toBeLessThan(due);
        const reminder = home.notice(eli, 'Reminder', title);
        await reminder.waitFor({ timeout: due - Date.now() + 2 * MINUTE });
        const arrivedAt = Date.now();
        expect(arrivedAt, 'not before its time').toBeGreaterThanOrEqual(due - 2_000);
        expect(arrivedAt - due, 'milliseconds after its time').toBeLessThanOrEqual(MINUTE);
        await expect(reminder).toContainText(/⏰\s*Reminder:/);
      });
    } finally {
      await data.deleteEvent(page, id);
      for (const opened of windows) await opened.context().close();
    }
  });
});
