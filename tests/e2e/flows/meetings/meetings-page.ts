import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import {
  DEFAULT_TIME_ZONE,
  expect,
  shownDate,
  signInAs,
  type PersonKey,
} from '../_support/index.js';

/** `text` with its RegExp characters escaped. */
export const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A whole word or name, for example `word('Avery')` matches "Avery Admin". */
export const word = (text: string) => new RegExp(`\\b${escape(text)}\\b`);

/** Signs `who` in, in a window of their own (separate cookies). */
export async function windowFor(browser: Browser, who: PersonKey): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, who);
  return page;
}

// ---- Dates: civil dates ("2026-11-17") and "HH:mm" in the person's time zone ----

function dateAndTime(at: number, timeZone = DEFAULT_TIME_ZONE) {
  const format = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const [date = '', time = ''] = format.format(at).split(' ');
  return { date, time };
}

const asUtc = (date: string, time: string) => Date.parse(`${date}T${time}:00Z`);

export function addDays(date: string, days: number): string {
  return new Date(asUtc(date, '00:00') + days * 86_400_000).toISOString().slice(0, 10);
}

/** The moment a wall-clock date and time happen in the default time zone. */
export function momentAt(date: string, time: string): number {
  const guess = asUtc(date, time);
  const shown = dateAndTime(guess);
  return guess - (asUtc(shown.date, shown.time) - guess);
}

const noon = (date: string) => new Date(asUtc(date, '12:00'));

/** The Sunday of the week `weeks` from this one (weeks start on Sunday by default). */
export function sundayIn(weeks: number): string {
  const today = dateAndTime(Date.now()).date;
  return addDays(today, 7 * weeks - noon(today).getUTCDay());
}

/** The notes page's title: "[event title] · Oct 27, 2026" (section 3). */
export const notesTitle = (title: string, at: number) => `${title} · ${shownDate(new Date(at))}`;

// ---- Calendar, as far as Meetings needs it: the event panel of one event ----

/** The period label of the week from `sunday`: "Oct 25 – 31, 2026" (Calendar spec, section 2). */
function weekPeriod(sunday: string): RegExp {
  const named = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(noon(date));
  const last = addDays(sunday, 6);
  const [month, day] = [
    (d: string) => named(d, { month: 'short' }),
    (d: string) => named(d, { day: 'numeric' }),
  ];
  const newYear = sunday.slice(0, 4) !== last.slice(0, 4);
  const from = `${month(sunday)} ${day(sunday)}${newYear ? `, ${sunday.slice(0, 4)}` : ''}`;
  const to = `${newYear || month(sunday) !== month(last) ? `${month(last)} ` : ''}${day(last)}`;
  return new RegExp(`^${from}\\s*[–-]\\s*${to}, ${last.slice(0, 4)}$`);
}

/** An item on the Calendar grid: its full name starts with its title (Calendar, section 6). */
export function eventBlock(page: Page, title: string): Locator {
  const name = new RegExp(`^${escape(title)}, `);
  return page
    .getByRole('button', { name })
    .or(page.getByRole('link', { name }))
    .or(page.getByRole('gridcell', { name }))
    .or(page.getByRole('option', { name }))
    .first();
}

/** Calendar on the week from `sunday` (Week view, stepping with ›), with `title`'s panel open. */
export async function openEvent(page: Page, title: string, sunday: string): Promise<void> {
  await page.goto('/calendar');
  const todayButton = page.getByRole('button', { name: 'Today', exact: true });
  await expect(todayButton).toBeVisible();
  const week = { name: 'Week', exact: true };
  await page
    .getByRole('radio', week)
    .or(page.getByRole('tab', week))
    .or(page.getByRole('button', week))
    .first()
    .click();
  await todayButton.click();
  // ‹ and › come right after Today in the top bar.
  const next = todayButton.locator('xpath=following::button[2]');
  for (let step = 0; step < 52; step += 1) {
    if (await page.getByText(weekPeriod(sunday)).first().isVisible()) break;
    await next.click();
    await page.waitForLoadState();
  }
  await expect(page.getByText(weekPeriod(sunday)).first()).toBeVisible();
  await eventBlock(page, title).click();
}

/** "Take meeting notes", or "Open notes" once the event has notes (Calendar, section 2). */
export function notesButton(page: Page): Locator {
  const name = /^(Take meeting notes|Open notes)$/;
  return page.getByRole('button', { name }).or(page.getByRole('link', { name })).first();
}

/** The ID in a page address, /p/<id>. */
export function pageIdIn(url: string): string {
  const id = /\/p\/([^/?#]+)/.exec(new URL(url).pathname)?.[1];
  if (!id) throw new Error(`Not a page address: ${url}`);
  return id;
}

/** Take meeting notes from the event panel; returns the notes page's ID once it's open. */
export async function takeNotes(page: Page, title: string, sunday: string): Promise<string> {
  await openEvent(page, title, sunday);
  await notesButton(page).click();
  await page.waitForURL(/\/p\/[^/?#]+/);
  return pageIdIn(page.url());
}

// ---- The meeting notes page ----

/** The sections of a meeting notes block, in order (section 2). */
export const sections = [
  'Agenda',
  'Attendees',
  'Video link',
  'Notes',
  'Action items',
  'Summary',
  'Your transcript',
] as const;
export type Section = (typeof sections)[number];

/** A section's heading (or its labelled region). */
export function sectionHeading(page: Page, name: Section): Locator {
  const exact = { name, exact: true };
  return page.getByRole('heading', exact).or(page.getByRole('region', exact)).first();
}

/** The first block under a section's heading, where its text goes. */
export function sectionFirstBlock(page: Page, name: Section): Locator {
  return page.getByRole('heading', { name, exact: true }).locator('xpath=following-sibling::*[1]');
}

/** Types into the start of a section, as a person clicks under its heading and writes. */
export async function writeIn(page: Page, name: Section, text: string): Promise<void> {
  await sectionFirstBlock(page, name).click();
  await page.keyboard.type(text);
}

/**
 * Adds a to-do with an @mention in Action items: "@Avery send the new rota". The mention is
 * picked from the menu that "@" opens (Comments and mentions).
 */
export async function addActionItem(page: Page, firstName: string, text: string): Promise<Locator> {
  const block = sectionFirstBlock(page, 'Action items');
  await block.click();
  // Action items are to-dos; "[] " makes one if the section starts with plain text.
  if ((await block.getByRole('checkbox').count()) === 0) await page.keyboard.type('[] ');
  await page.keyboard.type(`@${firstName}`);
  await page
    .getByRole('option', { name: word(firstName) })
    .first()
    .click();
  await page.keyboard.type(` ${text}`);
  const todo = todoWith(page, text);
  await expect(todo).toBeVisible();
  return todo;
}

/** The to-do on the page whose text includes `text` (the smallest block with a checkbox). */
export function todoWith(page: Page, text: string): Locator {
  return page
    .getByRole('main')
    .locator('*', { hasText: text })
    .filter({ has: page.getByRole('checkbox') })
    .last();
}

/** "You don't have access to this." without the title or any content (rules for every spec). */
export async function expectNoAccess(page: Page, title: string): Promise<void> {
  await expect(page.getByText("You don't have access to this.")).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
}

// ---- The microphone ----

/**
 * Stands in for the microphone in `context`: getUserMedia is recorded and answers with a quiet
 * tone, so a test can tell whether and when Care Hub started the microphone.
 */
export async function recordMicrophone(context: BrowserContext): Promise<void> {
  await context.grantPermissions(['microphone']);
  await context.addInitScript(() => {
    const asked: string[] = [];
    Object.assign(window, { qaMicrophone: asked });
    const media = navigator.mediaDevices;
    if (!media) return;
    media.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      asked.push(JSON.stringify(constraints ?? {}));
      const audio = new AudioContext();
      const tone = audio.createOscillator();
      const out = audio.createMediaStreamDestination();
      tone.connect(out);
      tone.start();
      return out.stream;
    };
  });
}

/** What Care Hub asked the microphone for so far, one entry per getUserMedia call. */
export function microphoneAsks(page: Page): Promise<string[]> {
  return page.evaluate(() => [
    ...((window as unknown as { qaMicrophone?: string[] }).qaMicrophone ?? []),
  ]);
}

// ---- All meeting notes ----

/** Calendar's left panel → Meeting notes (section 2). */
export async function openAllMeetingNotes(page: Page): Promise<void> {
  await page.goto('/calendar');
  const name = { name: 'Meeting notes', exact: true };
  await page.getByRole('link', name).or(page.getByRole('button', name)).first().click();
  await expect(page.getByRole('heading', { name: /meeting notes/i }).first()).toBeVisible();
}

/** A filter or tab by its name, whether it's a tab, a radio button, a button or an option. */
export async function choose(page: Page, name: string): Promise<void> {
  const main = page.getByRole('main');
  const exact = { name, exact: true };
  const control = main
    .getByRole('tab', exact)
    .or(main.getByRole('radio', exact))
    .or(main.getByRole('button', exact))
    .first();
  if (await control.isVisible()) {
    await control.click();
    return;
  }
  // A select: open it and pick the option.
  await main.getByRole('combobox').first().click();
  await page.getByRole('option', exact).click();
}

/** Types into All meeting notes' search box, which searches by title. */
export async function searchNotes(page: Page, text: string): Promise<void> {
  const main = page.getByRole('main');
  await main
    .getByRole('searchbox')
    .or(main.getByRole('textbox', { name: /search/i }))
    .or(main.getByPlaceholder(/search/i))
    .first()
    .fill(text);
}
