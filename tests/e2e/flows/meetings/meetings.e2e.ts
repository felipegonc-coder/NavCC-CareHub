import type { Page } from '@playwright/test';
import { expect, needs, onlyIn, people, signInAs, test, uniqueName } from '../_support/index.js';
import * as data from './meetings-data.js';
import * as mt from './meetings-page.js';

// The Meetings ⭐ checks, from the Meetings spec's Done means and section 7 (MT-11 is in
// claude/switches.e2e.ts, with the other checks of the Claude switches). Avery (the
// fictional admin) organizes and the seeded Eli plays the spec's Sam. Each flow has a week of its
// own and unique titles, because the whole run shares one database. Times are in America/Denver.

const { MINUTE } = data;
const zoom = 'https://us02web.zoom.us/j/81234567890?pwd=fictional';

/** A one-hour slot on day `day` (0 is Sunday) of the week from `sunday`, at `time`. */
function slot(sunday: string, day: number, time: string) {
  const start = mt.momentAt(mt.addDays(sunday, day), time);
  return { start, end: start + 60 * MINUTE };
}

/** A person's first name, as menus and lists show them ("Eli" of "Eli Editor"). */
const firstName = (member: data.Member) => member.name.split(' ')[0] ?? member.name;

test.describe('Meetings: notes pages', () => {
  onlyIn('desktop-light');
  needs('signIn', 'calendar', 'meetings', 'pages');

  test('MT-01 Take meeting notes makes one page with the title, sections and event details; a second click opens it; two people clicking at once get one page', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'admin');
    const eli = await data.member(page, people.editor.email);
    const sunday = mt.sundayIn(7);
    const title = uniqueName('Team huddle');
    const tuesday = slot(sunday, 2, '10:00');
    const events: string[] = [];
    const windows: Page[] = [];
    try {
      const eventId = await data.createEvent(page, {
        title,
        ...tuesday,
        videoUrl: zoom,
        people: [eli.id],
      });
      events.push(eventId);
      let notesId = '';
      const main = page.getByRole('main');

      await test.step('Take meeting notes opens a new page titled "Team huddle · date"', async () => {
        notesId = await mt.takeNotes(page, title, sunday);
        const name = mt.notesTitle(title, tuesday.start);
        await expect(main.getByText(name, { exact: true }).first()).toBeVisible();
        expect(await data.notesPageOf(page, eventId), "the event's notes page").toBe(notesId);
      });

      await test.step('it has every section in order, and the event details in its header', async () => {
        const tops: number[] = [];
        for (const name of mt.sections) {
          const heading = mt.sectionHeading(page, name);
          await expect(heading, name).toBeVisible();
          tops.push((await heading.boundingBox())?.y ?? Number.NaN);
        }
        expect(tops, 'Agenda to Your transcript, top to bottom').toEqual(
          [...tops].sort((a, b) => a - b),
        );
        await expect(main.getByText(/10:00\s*(AM\s*)?(to|–|-)\s*11:00\s*AM/).first()).toBeVisible();
        await expect(main.getByRole('link', { name: /^Join\b/ }).first()).toHaveAttribute(
          'href',
          /^https:\/\/us02web\.zoom\.us\/j\/81234567890/,
        );
        const inCalendar = { name: 'Open in Calendar', exact: true };
        await expect(
          main.getByRole('link', inCalendar).or(main.getByRole('button', inCalendar)).first(),
        ).toBeVisible();
        await expect(main.getByText(mt.word(firstName(eli))).first()).toBeVisible();
      });

      await test.step('clicking it again opens the same page', async () => {
        expect(await mt.takeNotes(page, title, sunday)).toBe(notesId);
      });

      await test.step('Avery and Eli clicking at the same moment get one page', async () => {
        const second = uniqueName('Team huddle');
        const wednesday = slot(sunday, 3, '10:00');
        const secondId = await data.createEvent(page, {
          title: second,
          ...wednesday,
          people: [eli.id],
        });
        events.push(secondId);
        const eliPage = await mt.windowFor(browser, 'editor');
        windows.push(eliPage);
        const both = [page, eliPage];
        await Promise.all(both.map((one) => mt.openEvent(one, second, sunday)));
        await Promise.all(both.map((one) => expect(mt.notesButton(one)).toBeVisible()));
        await Promise.all(both.map((one) => mt.notesButton(one).click()));
        await Promise.all(both.map((one) => one.waitForURL(/\/p\/[^/?#]+/)));
        expect(mt.pageIdIn(eliPage.url()), 'the page Eli got').toBe(mt.pageIdIn(page.url()));
        expect(await data.notesPageOf(page, secondId)).toBe(mt.pageIdIn(page.url()));
      });
    } finally {
      for (const id of events) await data.deleteEvent(page, id);
      for (const opened of windows) await opened.context().close();
    }
  });
});

test.describe('Meetings: who can open the notes', () => {
  onlyIn('desktop-light');
  needs('signIn', 'calendar', 'meetings', 'pages', 'editor');

  test('MT-02 Eli, an attendee, can edit the notes until he is removed from the event, then loses access', async ({
    page,
    browser,
  }) => {
    await signInAs(page, 'admin');
    const eli = await data.member(page, people.editor.email);
    const sunday = mt.sundayIn(8);
    const title = uniqueName('Team huddle');
    const line = uniqueName('Fictional QA note from Eli');
    const windows: Page[] = [];
    const eventId = await data.createEvent(page, {
      title,
      ...slot(sunday, 2, '10:00'),
      people: [eli.id],
    });
    try {
      const notesId = await mt.takeNotes(page, title, sunday);
      const eliPage = await mt.windowFor(browser, 'editor');
      windows.push(eliPage);

      await test.step('Eli opens the notes and writes in Notes', async () => {
        await eliPage.goto(`/p/${notesId}`);
        await expect(mt.sectionHeading(eliPage, 'Notes')).toBeVisible();
        await mt.writeIn(eliPage, 'Notes', line);
        await expect(eliPage.getByText(line).first()).toBeVisible();
      });

      await test.step('Avery sees what Eli wrote', async () => {
        await expect(async () => {
          await page.reload();
          await expect(page.getByText(line).first()).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: 30_000 });
      });

      await test.step('once Avery removes him from the event, Eli loses access', async () => {
        await data.setPeople(page, eventId, []);
        await expect(async () => {
          await eliPage.reload();
          await mt.expectNoAccess(eliPage, title);
        }).toPass({ timeout: 30_000 });
        expect(await data.pageStatus(eliPage, notesId), 'a direct request').toBe(403);
      });
    } finally {
      await data.deleteEvent(page, eventId);
      for (const opened of windows) await opened.context().close();
    }
  });

  test('MT-02 an outside guest of a Google or iCloud event shows in Attendees only as text', () => {
    // Care Hub events invite members only; outside guests come with synced Google or iCloud
    // events. The plan: a fictional .ics served on 127.0.0.1, once the safe fetcher (#203) may
    // read loopback addresses in tests (or a test route adds a synced event). No by-hand step.
    test.fixme(true, 'Needs a synced event with an outside guest: a local .ics or a test route');
  });
});

test.describe('Meetings: transcription consent', () => {
  onlyIn('desktop-light');
  needs('signIn', 'calendar', 'meetings', 'pages');

  test('MT-05 Start transcribing shows the consent dialog first, and the microphone starts only once "I\'ve told everyone in this meeting" is ticked', async ({
    page,
    context,
  }) => {
    await mt.recordMicrophone(context);
    await signInAs(page, 'admin');
    const eli = await data.member(page, people.editor.email);
    const sunday = mt.sundayIn(9);
    const title = uniqueName('Team huddle');
    const eventId = await data.createEvent(page, {
      title,
      ...slot(sunday, 2, '10:00'),
      people: [eli.id],
    });
    try {
      await mt.takeNotes(page, title, sunday);
      const main = page.getByRole('main');
      const startButton = main.getByRole('button', { name: 'Start transcribing', exact: true });
      const notSetUp = main.getByText("Transcription isn't set up yet.");
      await expect(startButton.or(notSetUp).first()).toBeVisible();
      // Without MODELS_DIR (as in CI) the server has no speech model and says so instead
      // (docs/team/settings.md).
      test.skip(await notSetUp.isVisible(), "Transcription isn't set up on this server");

      const dialog = page
        .getByRole('dialog')
        .or(page.getByRole('alertdialog'))
        .filter({ hasText: 'Tell everyone before you record.' });
      const told = dialog.getByRole('checkbox', { name: "I've told everyone in this meeting" });
      const confirm = dialog
        .getByRole('button', { name: /^(start|record|continue|confirm|ok|begin)/i })
        .last();
      const asked = () => mt.microphoneAsks(page);

      await test.step('Start transcribing opens the consent dialog; the microphone stays off', async () => {
        await startButton.click();
        await expect(dialog).toContainText(
          'Tell everyone before you record. Recording people without their consent may be against the law.',
        );
        await expect(told).not.toBeChecked();
        expect(await asked()).toEqual([]);
      });

      await test.step('unticked, it starts nothing, and focus stays in the dialog', async () => {
        if (await confirm.isEnabled()) await confirm.click();
        await expect(dialog).toBeVisible();
        for (let press = 0; press < 8; press += 1) {
          await page.keyboard.press('Tab');
          await expect(dialog.locator(':focus'), `after ${press + 1} Tab presses`).toHaveCount(1);
        }
        expect(await asked()).toEqual([]);
      });

      await test.step('Cancel closes it, with the microphone still off', async () => {
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(dialog).toBeHidden();
        await page.waitForTimeout(1_000);
        expect(await asked()).toEqual([]);
      });

      await test.step('ticked and confirmed, the microphone starts', async () => {
        await startButton.click();
        await told.check();
        expect(await asked(), 'ticking alone starts nothing').toEqual([]);
        await confirm.click();
        await expect(dialog).toBeHidden();
        await expect
          .poll(async () => (await asked()).length, { timeout: MINUTE })
          .toBeGreaterThan(0);
        expect((await asked())[0], 'asks for sound').toContain('audio');
      });

      const stop = main.getByRole('button', { name: 'Stop', exact: true });
      if (await stop.isVisible()) await stop.click();
    } finally {
      await data.deleteEvent(page, eventId);
    }
  });
});

test.describe('Meetings: all meeting notes and my action items', () => {
  onlyIn('desktop-light');
  needs('signIn', 'calendar', 'meetings', 'pages', 'editor', 'comments');

  test('MT-15 All meeting notes lists only notes Avery can open and its filters work; My action items lists "@Avery send the new rota" with its meeting, and ticking it there ticks it in the notes', async ({
    page,
    browser,
  }) => {
    test.setTimeout(5 * MINUTE);
    const tag = uniqueName('MT-15');
    const titles = {
      team: `Team huddle ${tag}`,
      closed: `Private huddle ${tag}`,
      mine: `Check-in ${tag}`,
    };
    const rota = `send the new rota ${tag}`;
    const sunday = mt.sundayIn(11);
    const eliPage = await mt.windowFor(browser, 'editor');
    await signInAs(page, 'admin');
    const [avery, val, eli] = await Promise.all([
      data.member(eliPage, people.admin.email),
      data.member(eliPage, people.viewer.email),
      data.member(page, people.editor.email),
    ]);
    const made: Array<{ by: Page; id: string }> = [];
    const meet = async (by: Page, event: data.NewEvent) => {
      made.push({ by, id: await data.createEvent(by, event) });
    };
    const main = page.getByRole('main');
    /** The list, after picking `filter` and searching for this run's titles. */
    const show = async (filter: string) => {
      await mt.choose(page, filter);
      await mt.searchNotes(page, tag);
    };
    try {
      // Eli's huddle with Avery, Eli's huddle with Val only, and Avery's own check-in with Eli.
      await meet(eliPage, { title: titles.team, ...slot(sunday, 2, '10:00'), people: [avery.id] });
      await meet(eliPage, { title: titles.closed, ...slot(sunday, 2, '13:00'), people: [val.id] });
      await meet(page, { title: titles.mine, ...slot(sunday, 3, '10:00'), people: [eli.id] });
      let teamNotes = '';

      await test.step('Eli takes notes and adds the to-do "@Avery send the new rota"', async () => {
        teamNotes = await mt.takeNotes(eliPage, titles.team, sunday);
        await mt.addActionItem(eliPage, firstName(avery), rota);
        await expect(async () => {
          await eliPage.reload();
          await expect(mt.todoWith(eliPage, rota)).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: 30_000 });
        await mt.takeNotes(eliPage, titles.closed, sunday);
        await mt.takeNotes(page, titles.mine, sunday);
      });

      await test.step("All meeting notes lists the notes Avery can open, not Eli and Val's", async () => {
        await mt.openAllMeetingNotes(page);
        await mt.searchNotes(page, tag);
        await expect(main.getByText(titles.team).first()).toBeVisible();
        await expect(main.getByText(titles.mine).first()).toBeVisible();
        await expect(main.getByText(titles.closed)).toHaveCount(0);
      });

      await test.step('Taken by me, I attended and All I can open filter the list', async () => {
        await show('Taken by me');
        await expect(main.getByText(titles.mine).first()).toBeVisible();
        await expect(main.getByText(titles.team)).toHaveCount(0);
        await show('I attended');
        await expect(main.getByText(titles.team).first()).toBeVisible();
        await show('All I can open');
        await expect(main.getByText(titles.team).first()).toBeVisible();
        await expect(main.getByText(titles.mine).first()).toBeVisible();
        await expect(main.getByText(titles.closed)).toHaveCount(0);
      });

      await test.step('My action items lists the to-do with its meeting; ticking it ticks it in the notes', async () => {
        await mt.choose(page, 'My action items');
        const item = main
          .getByRole('listitem')
          .or(main.getByRole('row'))
          .filter({ hasText: rota })
          .first();
        await expect(item).toContainText(titles.team);
        // A ticked item may leave the list at once, so click rather than check().
        await item.getByRole('checkbox').click();
        await expect(async () => {
          await eliPage.goto(`/p/${teamNotes}`);
          await expect(mt.todoWith(eliPage, rota).getByRole('checkbox')).toBeChecked({
            timeout: 5_000,
          });
        }).toPass({ timeout: 30_000 });
      });
    } finally {
      for (const { by, id } of made) await data.deleteEvent(by, id);
      await eliPage.context().close();
    }
  });
});
