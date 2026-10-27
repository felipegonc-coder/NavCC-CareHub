import type { Browser, Locator, Page } from '@playwright/test';
import { DEFAULT_TIME_ZONE, expect, signInAs, type PersonKey } from '../_support/index.js';

/** Calendar is a full screen from the sidebar, at /calendar (docs/team/testing.md). */
export const calendarPath = '/calendar';

export type View = 'Day' | 'Week' | 'Month';

/** `text` with its RegExp characters escaped. */
export const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A whole word or name, for example `word('Eli')` matches "Eli Editor". */
export const word = (text: string) => new RegExp(`\\b${escape(text)}\\b`);

// Dates are civil dates ("2026-11-17") and times are "HH:mm", in the person's time zone.

/** A moment's date and 24-hour time in the person's time zone ("2026-10-27", "16:05"). */
export function dateAndTime(at: number, timeZone = DEFAULT_TIME_ZONE) {
  const format = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const [date = '', time = ''] = format.format(at).split(' ');
  return { date, time };
}

/** A wall-clock date and time read as if in UTC (epoch milliseconds). */
const asUtc = (date: string, time: string) => Date.parse(`${date}T${time}:00Z`);

/** A calendar date `days` after `date`. */
export function addDays(date: string, days: number): string {
  return new Date(asUtc(date, '00:00') + days * 86_400_000).toISOString().slice(0, 10);
}

/** The moment a wall-clock date and time happen in `timeZone` (epoch milliseconds). */
export function momentAt(date: string, time: string, timeZone = DEFAULT_TIME_ZONE): number {
  const guess = asUtc(date, time);
  const shown = dateAndTime(guess, timeZone);
  return guess - (asUtc(shown.date, shown.time) - guess);
}

const noon = (date: string) => new Date(asUtc(date, '12:00'));
const named = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(noon(date));

/** 0 for Sunday to 6 for Saturday. */
export const weekday = (date: string) => noon(date).getUTCDay();

/** The Sunday a date's week starts on (weeks start on Sunday unless the person changes it). */
export const sundayOf = (date: string) => addDays(date, -weekday(date));

/** "Tuesday, November 17", as an item's full name says its day (section 6). */
export const longDay = (date: string) =>
  named(date, { weekday: 'long', month: 'long', day: 'numeric' });

/** "10:00 to 11:00 AM" or "11:30 AM to 12:30 PM", as the app writes a time range. */
export function timeRange(start: string, end: string): string {
  const clock = (time: string) => {
    const hour = Number(time.slice(0, 2));
    return { text: `${hour % 12 || 12}:${time.slice(3)}`, half: hour < 12 ? 'AM' : 'PM' };
  };
  const from = clock(start);
  const to = clock(end);
  return from.half === to.half
    ? `${from.text} to ${to.text} ${to.half}`
    : `${from.text} ${from.half} to ${to.text} ${to.half}`;
}

/** The start of an item's full name: "Team huddle, Tuesday, November 17, 10:00 to 11:00 AM". */
export const fullName = (title: string, date: string, start: string, end: string) =>
  new RegExp(`^${escape(`${title}, ${longDay(date)}, ${timeRange(start, end)}`)}\\b`);

/** The period in the top bar: "Oct 25 – 31, 2026", "October 2026" or "Tuesday, Oct 27, 2026". */
export function periodOf(view: View, date: string): RegExp {
  const month = (d: string) => named(d, { month: 'short' });
  const day = (d: string) => named(d, { day: 'numeric' });
  const year = (d: string) => d.slice(0, 4);
  if (view === 'Month') return new RegExp(`^${named(date, { month: 'long' })} ${year(date)}$`);
  if (view === 'Day') {
    const weekdayName = named(date, { weekday: 'long' });
    return new RegExp(`^${weekdayName}, ${month(date)} ${day(date)}, ${year(date)}$`);
  }
  const first = sundayOf(date);
  const last = addDays(first, 6);
  const newYear = year(first) !== year(last);
  const from = newYear
    ? `${month(first)} ${day(first)}, ${year(first)}`
    : `${month(first)} ${day(first)}`;
  const to =
    newYear || month(first) !== month(last)
      ? `${month(last)} ${day(last)}, ${year(last)}`
      : `${day(last)}, ${year(last)}`;
  return new RegExp(`^${from}\\s*[–-]\\s*${to}$`);
}

/** The period label for `view` around `date`. */
export const period = (page: Page, view: View, date: string) =>
  page.getByText(periodOf(view, date)).first();

/** Today, in the person's time zone. */
export const today = () => dateAndTime(Date.now()).date;

export const todayButton = (page: Page) => page.getByRole('button', { name: 'Today', exact: true });

/** Opens Calendar and waits for its top bar. */
export async function openCalendar(page: Page): Promise<void> {
  await page.goto(calendarPath);
  await expect(page).toHaveTitle(/^Care Hub/);
  await expect(todayButton(page)).toBeVisible();
}

/** Day, Week or Month in the view switch (buttons, radio buttons or tabs). */
export function viewSwitch(page: Page, view: View): Locator {
  const name = { name: view, exact: true };
  return page
    .getByRole('radio', name)
    .or(page.getByRole('tab', name))
    .or(page.getByRole('button', name))
    .first();
}

/** Which of Day, Week and Month the view switch marks as chosen, if any. */
export function chosenView(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const chosen = [
      '[aria-checked="true"]',
      '[aria-selected="true"]',
      '[aria-pressed="true"]',
      '[aria-current]:not([aria-current="false"])',
      '[data-state="on"]',
      '[data-state="active"]',
    ].join(',');
    for (const element of document.querySelectorAll(chosen)) {
      const text = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
      if (text === 'Day' || text === 'Week' || text === 'Month') return text;
    }
    return null;
  });
}

/** Picks a view in the view switch and waits until it's the chosen one. */
export async function showView(page: Page, view: View): Promise<void> {
  await viewSwitch(page, view).click();
  await expect.poll(() => chosenView(page)).toBe(view);
}

/** ‹ and ›, which come right after Today in the top bar (section 2). */
const stepButton = (page: Page, step: 'previous' | 'next') =>
  todayButton(page).locator(`xpath=following::button[${step === 'previous' ? 1 : 2}]`);

/** Week view on the week that starts on `sunday`, stepped to with › or ‹ from this week. */
export async function goToWeek(page: Page, sunday: string): Promise<void> {
  await showView(page, 'Week');
  await todayButton(page).click();
  const thisWeek = sundayOf(today());
  const weeks = Math.round((noon(sunday).getTime() - noon(thisWeek).getTime()) / (7 * 86_400_000));
  for (let step = 1; step <= Math.abs(weeks); step += 1) {
    await stepButton(page, weeks > 0 ? 'next' : 'previous').click();
    const shown = addDays(thisWeek, 7 * step * Math.sign(weeks));
    await expect(period(page, 'Week', shown)).toBeVisible();
  }
  await expect(period(page, 'Week', sunday)).toBeVisible();
}

/**
 * An item on the grid, by its title. Screen readers hear each item in full (section 6), so its
 * name starts with the title: "QA calibration, Tuesday, October 27, 10:00 to 11:00 AM, Meetings".
 */
export function eventBlock(page: Page, title: string): Locator {
  const name = new RegExp(`^${escape(title)}, `);
  return page
    .getByRole('button', { name })
    .or(page.getByRole('link', { name }))
    .or(page.getByRole('gridcell', { name }))
    .or(page.getByRole('option', { name }))
    .first();
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(target: Locator): Promise<Box> {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  if (!box) throw new Error(`${target.toString()} has no box on screen`);
  return box;
}

/** "10 AM", as the hour lines are labelled with the 12-hour default. */
const hourLabel = (hour: number) => `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;

/** Where `hour`'s line is on screen and how many pixels a minute takes, from two hour labels. */
async function hourScale(page: Page, hour: number): Promise<{ y: number; perMinute: number }> {
  const label = (h: number) => page.getByText(new RegExp(`^${hourLabel(h)}$`)).first();
  const first = await boxOf(label(Math.min(hour, 22)));
  const next = await boxOf(label(Math.min(hour, 22) + 1));
  const perMinute = (next.y - first.y) / 60;
  const y = first.y + first.height / 2 + (hour - Math.min(hour, 22)) * 60 * perMinute;
  return { y, perMinute };
}

/**
 * The middle of `date`'s column, under its header ("Tue 17" in Week, "Tue" in Month). It looks for
 * the row where all seven day headers sit, so other text with a day name doesn't count.
 */
export async function columnX(page: Page, date: string): Promise<number> {
  const week = Array.from({ length: 7 }, (_, i) => addDays(sundayOf(date), i));
  const headers = await Promise.all(
    week.map(async (day) => {
      const name = new RegExp(
        `^(${named(day, { weekday: 'short' })}|${named(day, { weekday: 'long' })})\\b`,
      );
      const found = await page.getByText(name).all();
      const boxes = await Promise.all(found.map((header) => header.boundingBox()));
      return boxes.filter((box): box is Box => box !== null);
    }),
  );
  for (const sunday of headers[0] ?? []) {
    const row = headers.map((boxes) => boxes.find((box) => Math.abs(box.y - sunday.y) < 8));
    const header = row[weekday(date)];
    if (row.every(Boolean) && header) return header.x + header.width / 2;
  }
  throw new Error(`No row of day headers with ${named(date, { weekday: 'short' })} on screen`);
}

/** The spot just below `time`'s line in `date`'s column, in Day or Week view. */
export async function slotPoint(page: Page, date: string, time: string) {
  const hour = Number(time.slice(0, 2));
  const scale = await hourScale(page, hour);
  // Labels sit on their line or just under it; 2 minutes down is inside the slot either way.
  const y = scale.y + (Number(time.slice(3)) + 2) * scale.perMinute;
  return { x: await columnX(page, date), y, perMinute: scale.perMinute };
}

/** How far it is from `date`'s column to the next day's. */
export async function columnStep(page: Page, date: string): Promise<number> {
  return (await columnX(page, addDays(date, 1))) - (await columnX(page, date));
}

/** Pixels per minute in Day or Week view. */
export async function pixelsPerMinute(page: Page): Promise<number> {
  return (await hourScale(page, 10)).perMinute;
}

/** Presses, moves in small steps and lets go, as a person drags with a mouse. */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 4, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

/** Drags an item by its body `dy` pixels down and `dx` to the side. */
export async function moveBlock(page: Page, block: Locator, dy: number, dx = 0): Promise<void> {
  const box = await boxOf(block);
  const from = { x: box.x + box.width / 2, y: box.y + Math.min(10, box.height / 3) };
  await drag(page, from, { x: from.x + dx, y: from.y + dy });
}

/** Pulls an item's bottom edge `dy` pixels down. */
export async function resizeBlock(page: Page, block: Locator, dy: number): Promise<void> {
  const box = await boxOf(block);
  const from = { x: box.x + box.width / 2, y: box.y + box.height - 2 };
  await drag(page, from, { x: from.x, y: from.y + dy });
}

/** What has focus now: a field's value, or the text of an editable element. */
export function focusedText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    return element instanceof HTMLElement && element.isContentEditable
      ? (element.textContent ?? '')
      : '';
  });
}

/** Names the new event that has its title ready to type, then saves it. */
export async function nameNewEvent(page: Page, title: string): Promise<void> {
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  const save = page.getByRole('button', { name: /^save$/i });
  if (await save.isVisible()) await save.click();
}

/** Add people in the event panel: searches for a member by first name and picks them. */
export async function addPerson(page: Page, firstName: string): Promise<void> {
  await page.getByRole('button', { name: 'Add people', exact: true }).click();
  await page
    .getByRole('combobox')
    .or(page.getByRole('searchbox'))
    .or(page.getByPlaceholder(/search|name|people/i))
    .first()
    .fill(firstName);
  await page
    .getByRole('option', { name: word(firstName) })
    .first()
    .click();
  const done = page.getByRole('button', { name: /^(done|save|invite|add|send invites?)$/i });
  if (await done.isVisible()) await done.click();
}

/** Delete in the event panel, then the confirm. */
export async function deleteFromPanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Delete( event)?$/ }).click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
  await confirm.getByRole('button', { name: /^(delete|delete event|cancel meeting|yes)/i }).click();
  await expect(confirm).toBeHidden();
}

/** "Take meeting notes", or "Open notes" once there are notes. */
export const notesButtonName = /^(Take meeting notes|Open notes)$/;

/**
 * Upcoming in the right panel, when nothing is selected (section 2). The sidebar has an Upcoming
 * of its own; this one is the one with Take meeting notes or Open notes.
 */
export function upcoming(page: Page): Locator {
  const name = { name: 'Upcoming', exact: true };
  const notes = page
    .getByRole('button', { name: notesButtonName })
    .or(page.getByRole('link', { name: notesButtonName }));
  return page
    .getByRole('complementary', name)
    .or(page.getByRole('region', name))
    .filter({ has: notes })
    .first();
}

/** The "Join" control in a part of the screen (a link to the meeting, or a button). */
export function joinIn(scope: Locator): Locator {
  return scope
    .getByRole('link', { name: /^Join\b/ })
    .or(scope.getByRole('button', { name: /^Join\b/ }))
    .first();
}

/** Signs `who` in, in a window of their own (separate cookies). */
export async function windowFor(browser: Browser, who: PersonKey): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, who);
  return page;
}

/** Opens the 🔔 Care Hub chat in Messages (Messages spec, section 2). */
export async function openNotices(page: Page): Promise<void> {
  await page.goto('/messages');
  const main = page.getByRole('main');
  const row = { name: /^\W*Care Hub/ };
  await main.getByRole('link', row).or(main.getByRole('button', row)).first().click();
  await expect(main.getByRole('heading', row)).toBeVisible();
}

/** Notices in the open 🔔 chat that have `title` in them and match `kind`. */
export function notices(page: Page, title: string, kind: RegExp): Locator {
  const main = page.getByRole('main');
  return main
    .getByRole('article')
    .or(main.getByRole('listitem'))
    .filter({ hasText: title })
    .filter({ hasText: kind });
}

/** Checks that Join opens `url`: a link to it, or a button that opens it in a new tab. */
export async function expectJoinOpens(page: Page, join: Locator, url: string): Promise<void> {
  if ((await join.evaluate((element) => element.tagName)) === 'A') {
    await expect(join).toHaveAttribute('href', url);
    return;
  }
  // No outside internet in CI: answer for the meeting service instead.
  await page
    .context()
    .route(url, (route) => route.fulfill({ status: 200, body: 'Fictional meeting' }));
  const opened = page.waitForEvent('popup');
  await join.click();
  expect((await opened).url()).toBe(url);
}

/** Connect calendar → Google → Sign in with Google (section 2), as far as Care Hub goes. */
export async function startGoogleSignIn(page: Page): Promise<void> {
  const connect = { name: 'Connect calendar', exact: true };
  await page.getByRole('button', connect).or(page.getByRole('link', connect)).first().click();
  const google = { name: /^(Sign in with Google|Google)$/ };
  const choice = page
    .getByRole('button', google)
    .or(page.getByRole('menuitem', google))
    .or(page.getByRole('radio', google))
    .or(page.getByRole('link', google))
    .first();
  if (await choice.isEnabled()) await choice.click();
  const signIn = { name: 'Sign in with Google', exact: true };
  const next = page.getByRole('button', signIn).or(page.getByRole('link', signIn)).first();
  if ((await next.isVisible()) && (await next.isEnabled())) await next.click();
}
