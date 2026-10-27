import { expect, needs, onlyIn, shownTime, signInAs, test, uniqueName } from '../_support/index.js';
import * as data from './home-data.js';
import * as home from './home-page.js';

// Home, the first screen after signing in, and Remind me (Home and reminders spec). The ⭐ checks
// come first: HR-01, HR-15, HR-07 and HR-02. Times are in the person's time zone, the default
// America/Denver. The spec's Sam is Eli here (the seeded editor).

const MINUTE = 60_000;

test.describe('Home: sections and unread messages', () => {
  onlyIn('desktop-light');
  needs('signIn', 'home', 'messages');

  test('HR-01 the sections show in order, and a new message shows under Unread messages within 2 seconds', async ({
    page,
    browser,
  }) => {
    test.slow(); // two people sign in
    await signInAs(page, 'admin');
    await home.openHome(page);

    await test.step('the sections show in order, two columns read left to right', async () => {
      // My learning stays hidden until Learning ships, so only it may be missing.
      for (const name of home.sectionOrder.filter((n) => n !== 'My learning')) {
        await expect(home.section(page, name), `the ${name} section`).toBeVisible();
      }
      const { shown, inDocument, onScreen } = await home.sectionOrders(page);
      expect(inDocument, 'order for Tab and screen readers').toEqual(shown);
      expect(onScreen, 'order on screen').toEqual(shown);
      const first = await home.section(page, 'Upcoming').boundingBox();
      const second = await home.section(page, 'Unread messages').boundingBox();
      expect(second?.x ?? 0, 'Unread messages is right of Upcoming').toBeGreaterThan(
        (first?.x ?? 0) + (first?.width ?? 0) - 1,
      );
    });

    await test.step("Eli's message shows under Unread messages within 2 seconds", async () => {
      const eli = await home.windowFor(browser, 'editor');
      const tag = uniqueName('QA');
      const row = home.itemIn(page, 'Unread messages', tag);
      const shownAt = row.waitFor({ timeout: 60_000 }).then(() => Date.now());
      shownAt.catch(() => undefined); // awaited below; this only keeps an early failure quiet
      const sentAt = await home.sendMessage(eli, 'Avery', `${tag} can you cover the 2 PM queue?`);
      expect((await shownAt) - sentAt, 'milliseconds until Home showed it').toBeLessThanOrEqual(
        2_000,
      );
      await expect(row).toContainText(home.word('Eli'));
      await eli.context().close();
    });
  });
});

test.describe('Home: My tasks', () => {
  onlyIn('desktop-light');
  needs('signIn', 'home', 'databases');

  test('HR-15 My tasks lists both open rows assigned to me, overdue first; ticking one on Home or in Tickets removes it within 2 seconds', async ({
    page,
    context,
  }) => {
    test.slow(); // makes a database, then uses two tabs
    await signInAs(page, 'admin');
    const today = home.dateAndTime(Date.now()).date;
    const tickets = await data.createTickets(page, uniqueName('Tickets'));
    const me = await data.myUserId(page);
    const overdue = uniqueName('Fictional QA ticket: refund for order');
    const open = uniqueName('Fictional QA ticket: address change');
    const overdueId = await data.addTicket(page, tickets, overdue, me, home.addDays(today, -2));
    const openId = await data.addTicket(page, tickets, open, me, home.addDays(today, 3));
    await home.openHome(page);
    await home.chooseTaskDatabase(page, tickets.title);

    await test.step('both show, the overdue one first and marked Overdue', async () => {
      await expect(home.itemIn(page, 'My tasks', overdue)).toContainText('Overdue');
      await expect(home.itemIn(page, 'My tasks', open)).toBeVisible();
      await expect(home.itemIn(page, 'My tasks', open)).not.toContainText('Overdue');
      const items = await home.section(page, 'My tasks').getByRole('listitem').allInnerTexts();
      const place = (title: string) => items.findIndex((text) => text.includes(title));
      expect(place(overdue), 'the overdue row comes first').toBeLessThan(place(open));
    });

    await test.step('ticking the overdue one on Home removes it within 2 seconds', async () => {
      const item = home.itemIn(page, 'My tasks', overdue);
      const tickedAt = Date.now();
      await item.getByRole('checkbox').click();
      await item.waitFor({ state: 'hidden', timeout: 10_000 });
      expect(Date.now() - tickedAt, 'milliseconds until it left My tasks').toBeLessThanOrEqual(
        2_000,
      );
    });

    const table = await context.newPage();
    await test.step('in Tickets it is done too', async () => {
      await table.goto(`/p/${tickets.id}`);
      await expect(
        home.gridCell(table, overdueId, tickets.done).getByRole('checkbox'),
      ).toBeChecked();
    });

    await test.step('ticking the other one in Tickets removes it from Home within 2 seconds', async () => {
      const item = home.itemIn(page, 'My tasks', open);
      await expect(item).toBeVisible();
      const tickedAt = Date.now();
      await home.gridCell(table, openId, tickets.done).getByRole('checkbox').click();
      await item.waitFor({ state: 'hidden', timeout: 10_000 });
      expect(Date.now() - tickedAt, 'milliseconds until it left My tasks').toBeLessThanOrEqual(
        2_000,
      );
    });
  });
});

test.describe('Home: reminders', () => {
  onlyIn('desktop-light');
  needs('signIn', 'pages', 'home', 'reminders', 'messages', 'notices');

  test('HR-07 "In 1 hour" with a note is listed for an hour from now; at its time a reminder arrives in 🔔 with the note, a page card and buttons, plus a browser notification', async ({
    page,
    browser,
  }) => {
    test.setTimeout(5 * MINUTE); // waits for a reminder to come due
    await signInAs(page, 'admin');
    const title = uniqueName('Shift handover');
    const pageId = await data.createPage(page, title);

    await test.step('"In 1 hour" with the note Check the queue is listed for an hour from now', async () => {
      const before = Date.now();
      await home.remindMe(page, pageId, 'Check the queue', 'In 1 hour');
      const after = Date.now();
      await home.openHome(page);
      const seeAll = { name: 'See all' };
      const reminders = home.section(page, 'Reminders');
      await reminders
        .getByRole('link', seeAll)
        .or(reminders.getByRole('button', seeAll))
        .first()
        .click();
      const times = [before, after, after + MINUTE].map((at) =>
        shownTime(new Date(at + 60 * MINUTE)),
      );
      await expect(
        page
          .getByRole('main')
          .getByRole('listitem')
          .filter({ hasText: title })
          .filter({ hasText: 'Check the queue' }),
      ).toContainText(home.oneOf(times));
    });

    const note = 'Check the queue before the handover';
    const watcher = await home.backgroundWindow(browser, 'admin');
    await test.step('one set for a time arrives in 🔔 within a minute of it, with the note, the page card and the buttons', async () => {
      // Custom times are whole minutes; this leaves over a minute to set it.
      const due = Math.ceil((Date.now() + 75_000) / MINUTE) * MINUTE;
      await home.remindMe(page, pageId, note, { at: due });
      await home.openNotices(page);
      const arrived = home.notice(page, title, note);
      await arrived.waitFor({ timeout: due - Date.now() + 2 * MINUTE });
      const arrivedAt = Date.now();
      expect(arrivedAt, 'not before its time').toBeGreaterThanOrEqual(due - 2_000);
      expect(arrivedAt - due, 'milliseconds after its time').toBeLessThanOrEqual(MINUTE);
      await expect(arrived).toContainText(new RegExp(`⏰\\s*Reminder:\\s*${home.escape(title)}`));
      await expect(
        arrived.locator(`a[href$="/p/${pageId}"]`).first(),
        'the page card',
      ).toBeVisible();
      for (const name of ['Open', 'Snooze', 'Done']) {
        const button = { name: new RegExp(`^${name}\\b`) };
        await expect(
          arrived.getByRole('button', button).or(arrived.getByRole('link', button)).first(),
        ).toBeVisible();
      }
    });

    await test.step('with notifications allowed and the tab in the background, a browser notification shows too', async () => {
      await expect
        .poll(watcher.shown, { timeout: 15_000, message: 'browser notifications' })
        .toContainEqual(expect.stringContaining(note));
    });
    await watcher.page.context().close();
  });
});

test.describe('Home: Upcoming', () => {
  onlyIn('desktop-light');
  needs('signIn', 'home', 'calendar');

  test('HR-02 Upcoming shows only today and tomorrow, and Join shows from 10 minutes before a Zoom meeting until it ends', async ({
    page,
  }) => {
    test.setTimeout(6 * MINUTE); // waits for Join to come and go
    // Val's own calendar, so events from other flows don't crowd Upcoming's 6.
    await signInAs(page, 'viewer');
    const zoom = 'https://us02web.zoom.us/j/1234567890?pwd=fictional';
    const now = Date.now();
    const tomorrow = home.addDays(home.dateAndTime(now).date, 1);
    const event = (label: string, start: number, end: number): data.FictionalEvent => ({
      title: uniqueName(`Fictional QA ${label}`),
      start,
      end,
      videoLink: zoom,
    });
    // The spec's meeting starts in 12 minutes; 11 means a minute less of waiting.
    const soon = event('standup', now + 11 * MINUTE, now + 41 * MINUTE);
    const close = event('huddle', now + 9 * MINUTE, now + 39 * MINUTE);
    const underWay = event('review', now - 20 * MINUTE, now + 3 * MINUTE);
    const nextDay = event(
      'planning',
      home.momentAt(tomorrow, '12:00'),
      home.momentAt(tomorrow, '12:30'),
    );
    const later = event('retro', now + 49 * 60 * MINUTE, now + 50 * 60 * MINUTE);
    const item = (e: data.FictionalEvent) => home.itemIn(page, 'Upcoming', e.title);
    const ids: string[] = [];
    try {
      for (const e of [soon, close, underWay, nextDay, later])
        ids.push(await data.createEvent(page, e));
      await home.openHome(page);

      await test.step('today and tomorrow show, the day after does not', async () => {
        for (const e of [underWay, close, soon, nextDay]) await expect(item(e)).toBeVisible();
        await expect(item(later)).toHaveCount(0);
      });

      await test.step('Join shows for the one under way and the one in 9 minutes, not yet for the one in 11', async () => {
        await expect(home.joinIn(item(underWay))).toBeVisible();
        await expect(home.joinIn(item(close))).toBeVisible();
        await expect(home.joinIn(item(soon))).toHaveCount(0);
      });

      await test.step('Join shows for that one once it is 10 minutes away', async () => {
        const from = soon.start - 10 * MINUTE;
        await expect(home.joinIn(item(soon))).toBeVisible({ timeout: from - Date.now() + MINUTE });
        expect(Date.now(), 'not before 10 minutes to go').toBeGreaterThanOrEqual(from - 1_000);
      });

      await test.step('Join stays until the meeting ends, then goes', async () => {
        await expect(home.joinIn(item(underWay))).toBeVisible();
        await expect(home.joinIn(item(underWay))).toHaveCount(0, {
          timeout: underWay.end - Date.now() + MINUTE,
        });
        expect(Date.now(), 'not before it ends').toBeGreaterThanOrEqual(underWay.end - 1_000);
      });
    } finally {
      for (const id of ids) await data.deleteEvent(page, id);
    }
  });
});
