import type { Page } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import * as data from './calendar-data.js';
import * as cal from './calendar-page.js';

// The Calendar ⭐ checks, from the Calendar spec's Done means and section 7. Avery (the fictional
// admin) organizes, the seeded Eli plays the spec's Sam, and Val and Casey use calendars of their
// own, so flows that run at the same time never share a grid or an Upcoming. Every event gets a
// unique name because the whole run shares one database. Times are in America/Denver.

const { MINUTE } = data;
const zoom = 'https://us02web.zoom.us/j/81234567890?pwd=fictional';

/**
 * The Sunday of the first week, `weeksAhead` or more from now, whose Tuesday and Wednesday are
 * free from 9:00 AM to 1:00 PM on the person's calendar, so a click at 10:00 hits an empty slot.
 */
async function freeWeek(page: Page, weeksAhead: number): Promise<string> {
  for (let week = weeksAhead; week < weeksAhead + 8; week += 1) {
    const sunday = cal.addDays(cal.sundayOf(cal.today()), 7 * week);
    const items = await data.itemsBetween(page, sunday, cal.addDays(sunday, 7));
    const busy = [2, 3].some((day) => {
      const date = cal.addDays(sunday, day);
      const [from, to] = [cal.momentAt(date, '09:00'), cal.momentAt(date, '13:00')];
      return items.some((item) => data.overlaps(item, from, to));
    });
    if (!busy) return sunday;
  }
  throw new Error('No free Tuesday morning in the next 8 weeks');
}

test.describe('Calendar: making and moving events', () => {
  onlyIn('desktop-light');
  needs('signIn', 'calendar');

  test('CA-02 a click on Tuesday at 10:00 makes a 60-minute event; dragging moves it in 15-minute steps and resizes it; moving it in Month keeps its times', async ({
    page,
  }) => {
    await signInAs(page, 'admin');
    const title = uniqueName('Team huddle');
    const sunday = await freeWeek(page, 2);
    const tuesday = cal.addDays(sunday, 2);
    const wednesday = cal.addDays(sunday, 3);
    const block = cal.eventBlock(page, title);
    try {
      await cal.openCalendar(page);
      await cal.goToWeek(page, sunday);

      await test.step('a click at 10:00 makes a 60-minute event with the title ready to type', async () => {
        const slot = await cal.slotPoint(page, tuesday, '10:00');
        await page.mouse.click(slot.x, slot.y);
        await cal.nameNewEvent(page, title);
        await expect(block).toHaveAccessibleName(cal.fullName(title, tuesday, '10:00', '11:00'));
      });

      await test.step('dragging it 18 minutes down moves it to 10:15, a 15-minute step', async () => {
        await cal.moveBlock(page, block, 18 * (await cal.pixelsPerMinute(page)));
        await expect(block).toHaveAccessibleName(cal.fullName(title, tuesday, '10:15', '11:15'));
      });

      await test.step('pulling its bottom edge 17 minutes down makes it end at 11:30', async () => {
        await cal.resizeBlock(page, block, 17 * (await cal.pixelsPerMinute(page)));
        await expect(block).toHaveAccessibleName(cal.fullName(title, tuesday, '10:15', '11:30'));
      });

      await test.step('the new times are saved', async () => {
        await page.reload();
        await cal.goToWeek(page, sunday);
        await expect(block).toHaveAccessibleName(cal.fullName(title, tuesday, '10:15', '11:30'));
      });

      await test.step('moving it to Wednesday in Month keeps 10:15 to 11:30', async () => {
        await cal.showView(page, 'Month');
        await cal.moveBlock(page, block, 0, await cal.columnStep(page, tuesday));
        await expect(block).toHaveAccessibleName(cal.fullName(title, wednesday, '10:15', '11:30'));
      });
    } finally {
      await data.deleteByTitle(page, title, sunday, cal.addDays(sunday, 7));
    }
  });
});

test.describe('Calendar: views and single-key shortcuts', () => {
  onlyIn('desktop-light');
  needs('signIn', 'calendar');

  /** Calendar's Settings → Single-key shortcuts (section 2), then closes Settings. */
  async function setShortcuts(page: Page, on: boolean): Promise<void> {
    await page.getByRole('main').getByRole('button', { name: 'Settings', exact: true }).click();
    const name = /single-key shortcuts/i;
    await page
      .getByRole('switch', { name })
      .or(page.getByRole('checkbox', { name }))
      .first()
      .setChecked(on);
    await page.keyboard.press('Escape');
  }

  /** The first day of the month `months` after `date`'s. */
  const monthAfter = (date: string, months: number) => {
    const index = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + months;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
  };

  test('CA-01 Week is the default; T, D, W, M, J, K and C work; nothing switches while typing a title, or with the switch off', async ({
    page,
  }) => {
    // Val's own calendar, so no other flow switches her views or turns her shortcuts off.
    await signInAs(page, 'viewer');
    const day = cal.today();
    // Every single-key shortcut letter is in it: t, d, w, m, j, k and c.
    const title = uniqueName('Weekly team check-in walkthrough, job draft');
    const view = () => cal.chosenView(page);
    try {
      await cal.openCalendar(page);

      await test.step('Week is the default', async () => {
        await expect.poll(view).toBe('Week');
        await expect(cal.period(page, 'Week', day)).toBeVisible();
      });

      await test.step('D, W and M switch views', async () => {
        for (const [key, next] of [
          ['d', 'Day'],
          ['w', 'Week'],
          ['m', 'Month'],
        ] as const) {
          await page.keyboard.press(key);
          await expect.poll(view).toBe(next);
          await expect(cal.period(page, next, day)).toBeVisible();
        }
      });

      await test.step('J and K go to the next and previous month, and T comes back to today', async () => {
        await page.keyboard.press('j');
        await expect(cal.period(page, 'Month', monthAfter(day, 1))).toBeVisible();
        await page.keyboard.press('k');
        await expect(cal.period(page, 'Month', day)).toBeVisible();
        await page.keyboard.press('j');
        await page.keyboard.press('j');
        await expect(cal.period(page, 'Month', monthAfter(day, 2))).toBeVisible();
        await page.keyboard.press('t');
        await expect
          .poll(async () => {
            const shown = (await view()) as cal.View | null;
            return shown !== null && (await cal.period(page, shown, day).isVisible());
          })
          .toBe(true);
      });

      await test.step('C makes an event at the next half hour, and typing its title switches nothing', async () => {
        await page.keyboard.press('w');
        await expect.poll(view).toBe('Week');
        const halfHour = 30 * MINUTE;
        const start = Math.ceil(Date.now() / halfHour) * halfHour;
        await page.keyboard.press('c');
        await page.keyboard.type(title);
        expect(await cal.focusedText(page), 'every key went into the title').toBe(title);
        expect(await view()).toBe('Week');
        await expect(cal.period(page, 'Week', day)).toBeVisible();
        await page.keyboard.press('Enter');
        const made = async () =>
          (await data.itemsBetween(page, day, cal.addDays(day, 2))).find(
            (item) => item.title === title,
          );
        await expect.poll(async () => (await made())?.start).toBe(new Date(start).toISOString());
        const item = await made();
        expect(Date.parse(item?.end ?? '') - start, 'the default length').toBe(60 * MINUTE);
      });

      await test.step('with single-key shortcuts off in Settings, D does nothing', async () => {
        await page.keyboard.press('Escape');
        await setShortcuts(page, false);
        await page.keyboard.press('d');
        // Nothing should happen, so give it a moment to go wrong.
        await page.waitForTimeout(1_000);
        expect(await view()).toBe('Week');
      });
    } finally {
      await setShortcuts(page, true).catch(() => undefined);
      await data.deleteByTitle(page, title, day, cal.addDays(day, 2));
    }
  });
});

test.describe('Calendar: meetings', () => {
  onlyIn('desktop-light');
  needs('signIn', 'calendar', 'messages', 'notices');

  test('CA-06 adding Eli makes Team huddle a meeting on his Meetings layer, and he gets the invite, change and cancel notices', async ({
    page,
    browser,
  }) => {
    test.setTimeout(2 * MINUTE);
    await signInAs(page, 'admin');
    const eli = await cal.windowFor(browser, 'editor');
    const title = uniqueName('Team huddle');
    const sunday = cal.addDays(cal.sundayOf(cal.today()), 7 * 6);
    const tuesday = cal.addDays(sunday, 2);
    const at = (time: string) => cal.momentAt(tuesday, time);
    const id = await data.createEvent(page, { title, start: at('10:00'), end: at('11:00') });
    const notice = (kind: RegExp) => cal.notices(eli, title, kind).first();
    const meeting = (start: string, end: string) =>
      new RegExp(`${cal.escape(cal.timeRange(start, end))}, Meetings$`);
    try {
      await test.step('Avery adds Eli in the event panel, which makes it a meeting', async () => {
        await cal.openCalendar(page);
        await cal.goToWeek(page, sunday);
        await cal.eventBlock(page, title).click();
        await cal.addPerson(page, 'Eli');
        await expect(cal.eventBlock(page, title)).toHaveAccessibleName(meeting('10:00', '11:00'));
      });

      await test.step('Eli gets the invite in 🔔', async () => {
        await cal.openNotices(eli);
        await expect(notice(/invit|added you/i)).toBeVisible({ timeout: 15_000 });
      });

      await test.step("it shows on Eli's Meetings layer", async () => {
        await cal.openCalendar(eli);
        await cal.goToWeek(eli, sunday);
        await expect(cal.eventBlock(eli, title)).toHaveAccessibleName(meeting('10:00', '11:00'));
      });

      await test.step('a new time sends Eli a change notice', async () => {
        await data.moveEvent(page, id, at('11:00'), at('12:00'));
        await cal.openNotices(eli);
        await expect(notice(/chang|moved|new time|reschedul|11:00/i)).toBeVisible({
          timeout: 15_000,
        });
      });

      await test.step('cancelling it sends Eli a cancel notice, and it leaves his calendar', async () => {
        await page.reload();
        await cal.goToWeek(page, sunday);
        await cal.eventBlock(page, title).click();
        await cal.deleteFromPanel(page);
        await expect(cal.eventBlock(page, title)).toHaveCount(0);
        await cal.openNotices(eli);
        await expect(notice(/cancel/i)).toBeVisible({ timeout: 15_000 });
        await cal.openCalendar(eli);
        await cal.goToWeek(eli, sunday);
        await expect(cal.eventBlock(eli, title)).toHaveCount(0);
      });
    } finally {
      await data.deleteEvent(page, id);
      await eli.context().close();
    }
  });
});

test.describe('Calendar: Upcoming', () => {
  onlyIn('desktop-light');
  needs('signIn', 'calendar');

  test('CA-14 Upcoming shows the next meeting with a countdown, and Join works from 10 minutes before until the end', async ({
    page,
    browser,
  }) => {
    test.setTimeout(5 * MINUTE); // waits for Join to come and to go
    // Casey's and Eli's own Upcoming, so nothing else comes first; Avery is in both meetings.
    await signInAs(page, 'commenter');
    const eli = await cal.windowFor(browser, 'editor');
    const avery = await cal.windowFor(browser, 'admin');
    const people = [await data.myUserId(avery)];
    const now = Date.now();
    // Not quite 11 minutes ahead, so Join comes within a minute or so instead of 5.
    const soon = {
      title: uniqueName('Team huddle'),
      start: now + 10 * MINUTE + 40_000,
      end: now + 40 * MINUTE,
      videoUrl: zoom,
      people,
    };
    const underWay = {
      title: uniqueName('Shift review'),
      start: now - 20 * MINUTE,
      end: now + 100_000,
      videoUrl: zoom,
      people,
    };
    const made: [Page, string][] = [];
    try {
      made.push([page, await data.createEvent(page, soon)]);
      made.push([eli, await data.createEvent(eli, underWay)]);
      await cal.openCalendar(page);
      await cal.openCalendar(eli);
      const next = cal.upcoming(page);
      const current = cal.upcoming(eli);

      await test.step("Casey's Upcoming shows Team huddle with a countdown, and no Join yet", async () => {
        await expect(next).toContainText(soon.title);
        const left = Math.ceil((soon.start - Date.now()) / MINUTE);
        const minutes = [left - 1, left, left + 1].join('|');
        await expect(next).toContainText(new RegExp(`\\b(${minutes})\\s*(min|mins|minutes)\\b`));
        await expect(cal.joinIn(next)).toHaveCount(0);
      });

      await test.step('Join shows once Team huddle is 10 minutes away, not before, and opens its Zoom link', async () => {
        const from = soon.start - 10 * MINUTE;
        await expect(cal.joinIn(next)).toBeVisible({ timeout: from - Date.now() + MINUTE + 5_000 });
        expect(Date.now(), 'not before 10 minutes to go').toBeGreaterThanOrEqual(from - 1_000);
        await cal.expectJoinOpens(page, cal.joinIn(next), zoom);
      });

      await test.step("Eli's Upcoming shows Shift review under way with Join, until it ends", async () => {
        await expect(current).toContainText(underWay.title);
        await expect(cal.joinIn(current)).toBeVisible();
        await expect(cal.joinIn(current)).toHaveCount(0, {
          timeout: underWay.end - Date.now() + MINUTE + 5_000,
        });
        expect(Date.now(), 'not before it ends').toBeGreaterThanOrEqual(underWay.end - 1_000);
      });
    } finally {
      for (const [who, id] of made) await data.deleteEvent(who, id);
      await eli.context().close();
      await avery.context().close();
    }
  });
});

test.describe('Calendar: Google, read-only', () => {
  onlyIn('desktop-light');
  needs('signIn', 'calendar');

  // With the default config, Playwright starts the server with this process's settings.
  const googleSetUp = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CALENDAR_SECRET_KEY'].every(
    (key) => Boolean(process.env[key]?.trim()),
  );
  const notSetUp = /Google sign-in isn't set up yet\.|Calendar connections aren't set up yet\./;

  test('CA-07 connecting Google asks Google only for read-only access', async ({ page }) => {
    await signInAs(page, 'admin');
    const asked: URL[] = [];
    await page.context().route(/^https:\/\/accounts\.google\.com\//, async (route) => {
      asked.push(new URL(route.request().url()));
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Google</title>' });
    });
    await cal.openCalendar(page);
    await cal.startGoogleSignIn(page);
    if (!googleSetUp) {
      // CI has no Google settings (docs/team/settings.md), so Care Hub says so instead.
      await expect(page.getByText(notSetUp).first()).toBeVisible();
      test.skip(true, "Google sign-in isn't set up on this server, so there's no Google to ask");
    }
    await expect.poll(() => asked.length, { timeout: 15_000 }).toBeGreaterThan(0);
    const scopes = (asked[0]?.searchParams.get('scope') ?? '').split(' ').filter(Boolean);
    const calendar = scopes.filter((scope) => scope.includes('calendar'));
    expect(calendar, 'asks for calendar access').not.toHaveLength(0);
    for (const scope of calendar) expect(scope, 'read-only calendar access').toMatch(/\.readonly$/);
    for (const scope of scopes.filter((s) => !s.includes('calendar'))) {
      expect(scope, 'nothing else but who is signing in').toMatch(
        /^(openid|email|profile|https:\/\/www\.googleapis\.com\/auth\/userinfo\.(email|profile))$/,
      );
    }
  });

  /** Removes every connected calendar in Calendar's Settings (section 2). */
  async function removeConnections(page: Page): Promise<void> {
    await cal.openCalendar(page);
    await page.getByRole('main').getByRole('button', { name: 'Settings', exact: true }).click();
    const remove = page.getByRole('button', { name: /^Remove\b/ });
    await remove.first().waitFor({ timeout: 5_000 });
    for (let left = await remove.count(); left > 0; left -= 1) {
      await remove.first().click();
      const confirm = page.getByRole('alertdialog');
      if (await confirm.isVisible()) await confirm.getByRole('button', { name: /^Remove/ }).click();
      await expect(remove).toHaveCount(left - 1);
    }
  }

  // By hand only: CI has no internet and no Google test account.
  const googleState = process.env.E2E_GOOGLE_STATE;
  const googleToken = process.env.E2E_GOOGLE_TOKEN;

  test('CA-07 an event made, changed and deleted in Google shows in Care Hub at once on opening Calendar, read-only', async ({
    browser,
  }) => {
    test.skip(
      !googleSetUp || !googleState || !googleToken,
      'Runs by hand with Google sign-in set up and a Google test account: E2E_GOOGLE_STATE is a Playwright storage state signed in to it, E2E_GOOGLE_TOKEN an access token of it with calendar.events, to change things in Google',
    );
    test.setTimeout(20 * MINUTE);
    const context = await browser.newContext({ storageState: googleState });
    const page = await context.newPage();
    const google = data.googleCalendar(googleToken ?? '');
    const origin = new URL(test.info().project.use.baseURL ?? '').origin;
    await signInAs(page, 'admin');
    const tomorrow = cal.addDays(cal.today(), 1);
    const title = uniqueName('Fictional QA Google event');
    const renamed = `${title} (moved room)`;
    let googleId: string | undefined;

    /** Calendar opened afresh more than a minute after the last look, on tomorrow's week. */
    const reopen = async () => {
      await page.waitForTimeout(65_000);
      await cal.openCalendar(page);
      await cal.goToWeek(page, cal.sundayOf(tomorrow));
    };
    try {
      await test.step('connect Google: Google asks only for read-only access, then pick the calendars', async () => {
        await cal.openCalendar(page);
        await cal.startGoogleSignIn(page);
        await page.waitForURL(/^https:\/\/accounts\.google\.com\//);
        const scope = new URL(page.url()).searchParams.get('scope') ?? '';
        expect(
          scope.split(' ').filter((s) => s.includes('calendar') && !s.endsWith('.readonly')),
        ).toEqual([]);
        // Google's own pages: the account, the unverified-app warning, then the access.
        for (let step = 0; step < 6 && !page.url().startsWith(origin); step += 1) {
          const all = page.getByRole('checkbox', { name: /select all/i });
          if (await all.isVisible()) await all.check();
          await page
            .getByRole('button', { name: /^(continue|allow)$/i })
            .or(page.getByRole('link', { name: /^(continue|allow)$/i }))
            .or(page.locator('[data-identifier]'))
            .first()
            .click();
          await page.waitForLoadState();
        }
        await page.waitForURL((url) => url.origin === origin, { timeout: 60_000 });
        for (const box of await page.getByRole('dialog').getByRole('checkbox').all()) {
          await box.check();
        }
        const save = page.getByRole('button', { name: /^(save|done|show|show calendars)$/i });
        if (await save.isVisible()) await save.click();
      });

      await test.step('an event made in Google shows at once on opening Calendar', async () => {
        googleId = await google.create(
          title,
          cal.momentAt(tomorrow, '14:00'),
          cal.momentAt(tomorrow, '15:00'),
        );
        await reopen();
        await expect(cal.eventBlock(page, title)).toBeVisible({ timeout: 30_000 });
      });

      await test.step("it can't be dragged, edited, deleted or replied to", async () => {
        const block = cal.eventBlock(page, title);
        const name = cal.fullName(title, tomorrow, '14:00', '15:00');
        await expect(block).toHaveAccessibleName(name);
        await block.hover();
        await expect(page.getByText('Read-only', { exact: true }).first()).toBeVisible();
        await cal.moveBlock(page, block, 60 * (await cal.pixelsPerMinute(page)));
        await expect(block).toHaveAccessibleName(name);
        await block.click();
        const inGoogle = /^(Open|Reply) in Google Calendar$/;
        await expect(
          page
            .getByRole('link', { name: inGoogle })
            .or(page.getByRole('button', { name: inGoogle })),
        ).toBeVisible();
        for (const button of [/^Edit$/, /^Delete( event)?$/, /^Going$/, /^Maybe$/, /^Not going$/]) {
          await expect(page.getByRole('button', { name: button })).toHaveCount(0);
        }
        const items = await data.itemsBetween(page, tomorrow, cal.addDays(tomorrow, 1));
        const synced = items.find((item) => item.title === title)?.syncedEventId;
        const tried = await (
          await apiFor(page)
        ).send('PATCH', `/api/calendar/events/${synced}`, { title: 'x' });
        expect(tried.status(), 'a direct change is refused').toBe(403);
      });

      await test.step('a change made in Google shows on the next look', async () => {
        await google.rename(googleId ?? '', renamed);
        await reopen();
        await expect(cal.eventBlock(page, renamed)).toBeVisible({ timeout: 30_000 });
      });

      await test.step('deleting it in Google removes it from Care Hub', async () => {
        await google.remove(googleId ?? '');
        googleId = undefined;
        await reopen();
        await expect(cal.eventBlock(page, renamed)).toHaveCount(0, { timeout: 30_000 });
      });
    } finally {
      if (googleId) await google.remove(googleId).catch(() => undefined);
      // Settings → connected calendars → Remove, so Avery's calendar is as it was. Best effort.
      await removeConnections(page).catch(() => undefined);
      await context.close();
    }
  });
});
