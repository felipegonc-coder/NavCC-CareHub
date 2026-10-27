import type { Browser, Locator, Page } from '@playwright/test';
import { DEFAULT_TIME_ZONE, expect, signInAs, type PersonKey } from '../_support/index.js';

/** Home is the first screen after signing in, at / (decision 0007, section 5). */
export const homePath = '/';

/**
 * Home's sections in reading order (Home and reminders spec, section 2). My learning stays hidden
 * until Learning ships, so checks skip it when it isn't there.
 */
export const sectionOrder = [
  'Upcoming',
  'Unread messages',
  'My tasks',
  'Reminders',
  'My learning',
  'Recent pages',
] as const;
export type SectionName = (typeof sectionOrder)[number];

/** `text` with its RegExp characters escaped. */
export const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A whole word or name, for example `word('Eli')` matches "Eli Editor". */
export const word = (text: string) => new RegExp(`\\b${escape(text)}\\b`);

/** Text that has one of `texts` in it, with any kind of space between words ("4:05 PM"). */
export const oneOf = (texts: string[]) =>
  new RegExp([...new Set(texts)].map((t) => escape(t).replace(/\s+/g, '\\s+')).join('|'));

/** Opens Home and waits for the greeting ("Good afternoon, Avery · Monday, October 26"). */
export async function openHome(page: Page): Promise<void> {
  await page.goto(homePath);
  await expect(page).toHaveTitle(/^Care Hub/);
  await expect(
    page
      .getByRole('main')
      .getByText(/^Good (morning|afternoon|evening), /)
      .first(),
  ).toBeVisible();
}

/** A Home section: a labelled region with a heading (section 6). */
export function section(page: Page, name: SectionName): Locator {
  return page.getByRole('main').getByRole('region', { name, exact: true });
}

/** An item in a section, by text in it (an event, chat, task or reminder). */
export function itemIn(page: Page, name: SectionName, text: string): Locator {
  return section(page, name).getByRole('listitem').filter({ hasText: text });
}

/**
 * The sections on screen in `sectionOrder`, then in document order (what Tab and screen readers
 * follow) and in reading order on screen (rows top to bottom, each left to right).
 */
export async function sectionOrders(page: Page) {
  type Shown = { name: SectionName; at: number; box: { x: number; y: number } | null };
  const shown: Shown[] = [];
  for (const name of sectionOrder) {
    const region = section(page, name);
    if (!(await region.isVisible())) continue;
    const at = await region.evaluate((el) => [...document.querySelectorAll('*')].indexOf(el));
    shown.push({ name, at, box: await region.boundingBox() });
  }
  const top = (s: Shown) => Math.round(s.box?.y ?? 0);
  const left = (s: Shown) => s.box?.x ?? 0;
  return {
    shown: shown.map((s) => s.name),
    inDocument: [...shown].sort((a, b) => a.at - b.at).map((s) => s.name),
    onScreen: [...shown]
      .sort((a, b) => (Math.abs(top(a) - top(b)) <= 2 ? left(a) - left(b) : top(a) - top(b)))
      .map((s) => s.name),
  };
}

/** Signs `who` in, in a window of their own (separate cookies). */
export async function windowFor(browser: Browser, who: PersonKey): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, who);
  return page;
}

/**
 * Sends a direct message from `page`'s person: Messages, New message, the person, the text, Enter.
 * Returns the moment Enter was pressed.
 */
export async function sendMessage(page: Page, toFirstName: string, text: string): Promise<number> {
  await page.goto('/messages');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'New message' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox').or(dialog.getByRole('textbox')).first().fill(toFirstName);
  await page
    .getByRole('option', { name: word(toFirstName) })
    .first()
    .click();
  // Picking one person may open the chat straight away.
  const start = dialog.getByRole('button', { name: /^(start chat|start|open chat)$/i });
  if (await start.isVisible()) await start.click();
  const box = main.getByRole('textbox', { name: /^(?!search)/i }).last();
  await box.fill(text);
  const sentAt = Date.now();
  await box.press('Enter');
  await expect(main.getByText(text, { exact: true }).last()).toBeVisible();
  return sentAt;
}

/** The "Join" control of an item (a link to the meeting, or a button). */
export function joinIn(item: Locator): Locator {
  return item
    .getByRole('link', { name: /^Join\b/ })
    .or(item.getByRole('button', { name: /^Join\b/ }))
    .first();
}

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

/** A calendar date `days` after `date` (YYYY-MM-DD). */
export function addDays(date: string, days: number): string {
  return new Date(asUtc(date, '00:00') + days * 86_400_000).toISOString().slice(0, 10);
}

/** The moment a wall-clock date and time happen in `timeZone` (epoch milliseconds). */
export function momentAt(date: string, time: string, timeZone = DEFAULT_TIME_ZONE): number {
  const guess = asUtc(date, time);
  const shown = dateAndTime(guess, timeZone);
  return guess - (asUtc(shown.date, shown.time) - guess);
}

/**
 * Remind me from a page's "…" menu (Home spec, section 2): picks `choice` ("In 1 hour", or
 * "Custom date and time" typed in as `at`) and writes the note, in whichever order the picker asks.
 */
export async function remindMe(
  page: Page,
  pageId: string,
  note: string,
  choice: 'In 1 hour' | { at: number },
): Promise<void> {
  await page.goto(`/p/${pageId}`);
  await page
    .getByRole('banner')
    .getByRole('button', { name: /page menu|more|^…$/i })
    .last()
    .click();
  await page.getByRole('menuitem', { name: /^Remind me/ }).click();
  const noteBox = page.getByRole('textbox', { name: /note/i });
  const pick = (name: RegExp) =>
    page.getByRole('menuitem', { name }).or(page.getByRole('button', { name })).first();
  const confirm = pick(/^(set reminder|save|remind me|add reminder|done)$/i);
  await expect(pick(/^In 1 hour/)).toBeVisible();
  const noteFirst = await noteBox.isVisible();
  if (noteFirst) await noteBox.fill(note);
  if (choice === 'In 1 hour') {
    await pick(/^In 1 hour/).click();
  } else {
    await pick(/^Custom date and time/).click();
    const { date, time } = dateAndTime(choice.at);
    await page.getByLabel(/^date$/i).fill(date);
    await page.getByLabel(/^time$/i).fill(time);
    if (noteFirst) await confirm.click();
  }
  if (!noteFirst) {
    await noteBox.fill(note);
    await confirm.click();
  }
  await expect(noteBox).toBeHidden();
}

/** Opens the 🔔 Care Hub chat in Messages (Messages spec, section 2). */
export async function openNotices(page: Page): Promise<void> {
  await page.goto('/messages');
  const main = page.getByRole('main');
  const row = { name: /^\W*Care Hub/ };
  await main.getByRole('link', row).or(main.getByRole('button', row)).first().click();
  await expect(main.getByRole('heading', row)).toBeVisible();
}

/** A notice in the open 🔔 chat that has all of `texts` in it. */
export function notice(page: Page, ...texts: string[]): Locator {
  const main = page.getByRole('main');
  let found = main.getByRole('article').or(main.getByRole('listitem'));
  for (const text of texts) found = found.filter({ hasText: text });
  return found.first();
}

/**
 * A window of `who`'s own, with notifications allowed, put in the background on Messages. It
 * records the browser notifications Care Hub shows (window.Notification and the service worker's).
 */
export async function backgroundWindow(
  browser: Browser,
  who: PersonKey,
): Promise<{ page: Page; shown: () => Promise<string[]> }> {
  const context = await browser.newContext();
  await context.grantPermissions(['notifications']);
  await context.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { qaNotifications: seen });
    const Real = window.Notification;
    class Recording extends Real {
      constructor(title: string, options?: NotificationOptions) {
        super(title, options);
        seen.push(`${title} ${options?.body ?? ''}`);
      }
    }
    Object.defineProperty(window, 'Notification', { value: Recording, configurable: true });
    const show = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      seen.push(`${title} ${options?.body ?? ''}`);
      return show.call(this, title, options);
    };
  });
  const page = await context.newPage();
  await signInAs(page, who);
  await page.goto('/messages');
  // Messages may offer "Get notified about new messages? Turn on · Not now" first.
  const turnOn = page.getByRole('button', { name: 'Turn on', exact: true });
  if (await turnOn.isVisible()) await turnOn.click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.hasFocus = () => false;
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const shown = () =>
    page.evaluate(async () => {
      const seen = [...(window as unknown as { qaNotifications: string[] }).qaNotifications];
      try {
        const registration = await navigator.serviceWorker?.getRegistration();
        for (const n of (await registration?.getNotifications()) ?? []) {
          seen.push(`${n.title} ${n.body}`);
        }
      } catch {
        // No service worker here: the recorded ones are all there is.
      }
      return seen;
    });
  return { page, shown };
}

/** Ticks Tickets in "Choose task databases" under My tasks, so its rows count (section 2). */
export async function chooseTaskDatabase(page: Page, title: string): Promise<void> {
  const tasks = section(page, 'My tasks');
  const name = 'Choose task databases';
  await tasks.getByRole('button', { name }).or(tasks.getByRole('link', { name })).first().click();
  const dialog = page.getByRole('dialog');
  const search = dialog.getByRole('searchbox');
  if (await search.isVisible()) await search.fill(title);
  const choice = { name: word(title) };
  await dialog.getByRole('checkbox', choice).or(dialog.getByRole('switch', choice)).first().check();
  const save = dialog.getByRole('button', { name: /^(save|done)$/i });
  if (await save.isVisible()) await save.click();
  else await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

/** A cell in a database's table view (decision 0200: grid, data-row-id, data-property-id). */
export function gridCell(page: Page, rowId: string, propertyId: string): Locator {
  return page
    .getByRole('grid')
    .locator(
      `[role="row"][data-row-id="${rowId}"] [role="gridcell"][data-property-id="${propertyId}"]`,
    );
}
