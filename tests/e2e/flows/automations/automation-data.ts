import type { APIResponse, Page, Request } from '@playwright/test';
import { apiFor, DEFAULT_TIME_ZONE, expect } from '../_support/index.js';
import type { DatabaseScreen } from '../databases/database-page.js';
import type { AutomationEditor } from './automation-editor.js';
import { AutomationList } from './automation-list.js';

/** What the server answers to a request the person may not make (decision 0007). */
export const FORBIDDEN = {
  error: { code: 'forbidden', message: "You don't have access to this." },
};

/** Database triggers start their actions within 10 seconds; the open chat shows them within 2. */
export const TRIGGERED_MS = 12_000;

/** Edits to a row within 5 seconds of its first edit are checked once, 5 seconds after it. */
export const SETTLE_MS = 5_000;

/** The role Editor, as the recipients field offers it (not "Eli …"). */
// Editor stands in for the role Agent (spec), which isn't seeded; Eli, its one member, gets what an Agent would.
export const AGENT = /^(Role:?\s*)?Editors?\b/;

/**
 * Avery makes Weekday stand-up nudge from Automations → New automation: every weekday at
 * 9:00 AM, in her time zone (America/Denver), to the role standing in for Agent, saying `note`.
 */
export async function weekdayNudge(page: Page, name: string, note: string) {
  const editor: AutomationEditor = await new AutomationList(page).newAutomation();
  await editor.name().fill(name);
  await editor.pick('Trigger', 'Schedule');
  await editor.repeat('Every weekday');
  await editor.time('9:00 AM');
  await editor.addAction('Send a message');
  await editor.sendTo(AGENT);
  await editor.message().fill(note);
  const saved: Request = await editor.save();
  return { editor, saved };
}

/** The id of the person signed in on `page`. */
export async function userIdOf(page: Page): Promise<string> {
  const me = await (await apiFor(page)).get<{ user?: { id?: string } }>('/api/auth/me');
  if (!me.user?.id) throw new Error('GET /api/auth/me answered without a user id.');
  return me.user.id;
}

/**
 * Sends a request the screens made, such as Avery's Save, again as the person signed in on
 * `page`, with that person's cookies and CSRF token: a direct request the screens never offer.
 */
export async function sendAgainAs(page: Page, request: Request): Promise<APIResponse> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name.endsWith('carehub_csrf'))?.value ?? '';
  const headers: Record<string, string> = {
    'X-CSRF-Token': csrf,
    Origin: new URL(request.url()).origin,
  };
  const type = request.headers()['content-type'];
  if (type) headers['Content-Type'] = type;
  const data = request.postDataBuffer() ?? undefined;
  return page.request.fetch(request.url(), { method: request.method(), headers, data });
}

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;

/** The date and time a clock in the time zone shows at `at`. */
function clockAt(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    /** The date, as midnight UTC on that date. */
    day: new Date(Date.UTC(part('year'), part('month') - 1, part('day'))),
    hour: part('hour'),
    /** The date and time read as if they were UTC. */
    asUtc: Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    ),
  };
}

/** Monday to Friday. Days are dates as midnight UTC, so their UTC weekday is theirs. */
export function isWeekday(day: Date): boolean {
  return day.getUTCDay() !== 0 && day.getUTCDay() !== 6;
}

/** A day as step titles show it, such as "Wed, Oct 28". */
export function dayName(day: Date): string {
  const options = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' } as const;
  return new Intl.DateTimeFormat('en-US', options).format(day);
}

/** The first Monday to Friday whose 9:00 AM hasn't come yet at `from` in the time zone. */
export function firstWeekdayNine(from: Date, timeZone = DEFAULT_TIME_ZONE): Date {
  const { day: today, hour } = clockAt(from, timeZone);
  for (let days = hour < 9 ? 0 : 1; days < 8; days++) {
    const day = new Date(today.getTime() + days * DAY_MS);
    if (isWeekday(day)) return day;
  }
  throw new Error('There is always a weekday within a week.');
}

/**
 * The list's Next run for "every weekday at 9:00 AM" seen at `from`: the next Monday to Friday
 * whose 9:00 AM hasn't come yet in the time zone, by its date ("Oct 27"), its weekday, or Today or
 * Tomorrow, followed by 9:00 AM.
 */
export function nextWeekdayNine(from: Date, timeZone = DEFAULT_TIME_ZONE): RegExp {
  const day = firstWeekdayNine(from, timeZone);
  const shown = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(day);
  const weekday = shown({ weekday: 'long' });
  const words = [shown({ month: 'short', day: 'numeric' }), weekday, weekday.slice(0, 3)];
  const ahead = Math.round((day.getTime() - clockAt(from, timeZone).day.getTime()) / DAY_MS);
  if (ahead === 0) words.push('Today');
  if (ahead === 1) words.push('Tomorrow');
  return new RegExp(`\\b(${words.join('|')})\\b.*\\b9:00\\sAM`);
}

/**
 * The days a weekday 9:00 AM schedule made at `from` is checked on: from its first run through
 * the Monday after the next Saturday and Sunday.
 */
export function throughNextWeekend(from: Date, timeZone = DEFAULT_TIME_ZONE): Date[] {
  const first = firstWeekdayNine(from, timeZone);
  const days = [first];
  let weekend = false;
  for (let next = first.getTime() + DAY_MS; days.length < 9; next += DAY_MS) {
    const day = new Date(next);
    days.push(day);
    if (!isWeekday(day)) weekend = true;
    else if (weekend) return days;
  }
  throw new Error('There is always a weekend within a week.');
}

/** The instant a clock in the time zone shows `hour`:`minute`:`second` on `day` (a date). */
export function wallClock(
  day: Date,
  hour: number,
  minute = 0,
  second = 0,
  timeZone = DEFAULT_TIME_ZONE,
): Date {
  const wanted = day.getTime() + ((hour * 60 + minute) * 60 + second) * 1_000;
  /** How far the zone's clock is ahead of UTC at `at` (negative in Denver). */
  const offset = (at: number) => clockAt(new Date(at), timeZone).asUtc - at;
  return new Date(wanted - offset(wanted - offset(wanted)));
}

/** A cell as CSV writes it: quoted when it holds a comma, a quote or a line break. */
function quoted(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/**
 * "…" → Import CSV with a file the test made (a header row, then rows) → Import, as in the
 * Databases spec 3.7; waits for the summary, such as "Imported 20 rows."
 */
export async function importRows(screen: DatabaseScreen, rows: string[][]): Promise<void> {
  const csv = rows.map((cells) => `${cells.map(quoted).join(',')}\r\n`).join('');
  await screen.more('Import CSV');
  const dialog = screen.page.getByRole('dialog', { name: /Import/ });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'Fictional QA reviews.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  const start = dialog.getByRole('button', { name: /^Import\b/ }).last();
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  const summary = screen.page.getByText(`Imported ${rows.length - 1} rows.`).first();
  await expect(summary).toBeVisible({ timeout: 30_000 });
}
