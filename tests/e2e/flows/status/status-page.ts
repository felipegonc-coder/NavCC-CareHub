import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';

/** The Status page: the Care Hub web address plus /status (Status page spec, section 2). */
export const statusPath = '/status';

/** The overall status is always one of these words (never color alone). */
export const overallWords = /^(Working|Some problems|Down)$/;

/** Uptime as a percentage with two decimals, for example "99.90%" (section 3). */
export const uptimePercent = /\b\d{1,3}\.\d{2}\s?%/;

/** One day of the 30-day bar as screen readers hear it, for example "October 12: 99.2%". */
const dayName =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}: [^"\n]*/g;

/**
 * The parts only site admins see (section 2), as labels that start with the spec's names. Anchored,
 * so a sentence such as "Down means the server or database isn't working." doesn't count.
 */
export const parts = [
  /^\s*web app/i,
  /^\s*database/i,
  /^\s*file storage/i,
  /^\s*live editing/i,
  /^\s*background jobs/i,
  /^\s*calendar sync/i,
];

/** The screen's content. */
export function statusMain(page: Page): Locator {
  return page.getByRole('main');
}

/** Opens /status and waits for the overall status word. */
export async function openStatus(page: Page): Promise<void> {
  await page.goto(statusPath);
  await expect(statusMain(page).getByText(overallWords).first()).toBeVisible();
}

/** The days of the 30-day bar that screen readers can read, from the accessibility tree. */
export async function readableDays(page: Page): Promise<string[]> {
  const tree = await statusMain(page).ariaSnapshot();
  const names = tree.match(dayName) ?? [];
  // A day can show up twice (its name and its tooltip), so count each date once.
  return [...new Set(names.map((name) => name.slice(0, name.indexOf(':'))))];
}

/** A JSON answer from the server, as the page received it. */
export interface ApiAnswer {
  path: string;
  body: unknown;
}

/** Records every successful JSON answer from /api while the page is open. */
export function recordApiAnswers(page: Page): ApiAnswer[] {
  const answers: ApiAnswer[] = [];
  page.on('response', async (response) => {
    const { pathname } = new URL(response.url());
    const json = (response.headers()['content-type'] ?? '').includes('json');
    if (!pathname.startsWith('/api/') || !response.ok() || !json) return;
    try {
      answers.push({ path: pathname, body: await response.json() });
    } catch {
      // The page moved on before the body arrived; the next refresh is recorded instead.
    }
  });
  return answers;
}

/** Words in keys and texts that would mean the answer holds more than status and uptime. */
const adminOnlyWords = new Set([
  'part',
  'parts',
  'database',
  'storage',
  'disk',
  'job',
  'jobs',
  'calendar',
  'sync',
  'backup',
  'backups',
  'restore',
  'restores',
  'incident',
  'incidents',
  'version',
  'build',
  'live',
  'editing',
  'details',
]);

function words(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Every key or text in a JSON value that names something only site admins may see. */
export function adminOnlyFields(value: unknown, path = '$'): string[] {
  const named = (text: string) => words(text).some((word) => adminOnlyWords.has(word));
  if (typeof value === 'string') return named(value) ? [`${path} = ${JSON.stringify(value)}`] : [];
  if (Array.isArray(value))
    return value.flatMap((item, i) => adminOnlyFields(item, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => [
      ...(named(key) ? [`${path}.${key}`] : []),
      ...adminOnlyFields(item, `${path}.${key}`),
    ]);
  }
  return [];
}

/** The request a button sent, so the same request can be tried as someone else. */
export interface SentRequest {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  data: unknown;
}

/** Clicks a button and returns the state-changing /api request it sent, once it's answered. */
export async function clickAndCapture(page: Page, button: Locator): Promise<SentRequest> {
  const sent = page.waitForRequest((request) => {
    const { pathname } = new URL(request.url());
    return pathname.startsWith('/api/') && request.method() !== 'GET';
  });
  await button.click();
  const request = await sent;
  const response = await request.response();
  expect(response?.ok(), `${request.method()} ${request.url()} should be accepted`).toBe(true);
  const { pathname, search } = new URL(request.url());
  return {
    method: request.method() as SentRequest['method'],
    path: pathname + search,
    data: request.postData() ? request.postDataJSON() : undefined,
  };
}
