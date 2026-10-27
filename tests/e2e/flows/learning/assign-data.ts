import type { Locator, Page } from '@playwright/test';
import { DEFAULT_TIME_ZONE, apiFor, shownDate } from '../_support/index.js';

/**
 * Assignments and due dates for the Learning flows (docs/learning/api.md, assignments). The
 * request shape is the one api.md sketches; it lives only here, in `assign()`.
 */

/** The signed-in person (GET /api/auth/me, decision 0007 section 3.1). */
export async function whoIs(page: Page): Promise<{ id: string; name: string; email: string }> {
  const { user } = await (
    await apiFor(page)
  ).get<{ user: { id: string; name: string; email: string } }>('/api/auth/me');
  return user;
}

/** Today plus `days` as a calendar day (YYYY-MM-DD) in the default time zone. */
export function day(days = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIME_ZONE }).format(
    new Date(),
  );
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The next Friday after today ("due Friday" in PRD section 7, Phase 2). */
export function nextFriday(): string {
  const weekday = new Date(`${day()}T12:00:00Z`).getUTCDay();
  return day((5 - weekday + 7) % 7 || 7);
}

/** Whole days from today to a calendar day, negative once it has passed. */
export const daysUntil = (isoDay: string) =>
  Math.round((Date.parse(`${isoDay}T12:00:00Z`) - Date.parse(`${day()}T12:00:00Z`)) / 86_400_000);

/** How the "New course assigned" notice words a due date (learning/src/delivery/notices.ts). */
export function dueWords(isoDay: string): string {
  const days = daysUntil(isoDay);
  if (days === -1) return 'which was due yesterday';
  if (days === 0) return 'due today';
  return days === 1 ? 'due tomorrow' : `due in ${days} days`;
}

/** A calendar day the way the app shows it, for example "Oct 30, 2026". */
export const shownDay = (isoDay: string) => shownDate(new Date(`${isoDay}T12:00:00Z`));

/** Where a course's start page is, and links to it from notices, the calendar or Home. */
export const courseUrl = (courseId: string) => new RegExp(`/learning/courses/${courseId}$`);
export const linkToCourse = (scope: Page | Locator, courseId: string) =>
  scope.locator(`a[href$="/learning/courses/${courseId}"]`);

/** Assigns a course to people and groups, as the signed-in builder. */
export async function assign(
  page: Page,
  courseId: string,
  to: { people?: string[]; groups?: string[]; dueDate?: string },
) {
  const api = await apiFor(page);
  return api.post('/api/learning/assignments', {
    target: { kind: 'course', courseId },
    people: to.people ?? [],
    groups: to.groups ?? [],
    ...(to.dueDate === undefined ? {} : { dueDate: to.dueDate }),
  });
}

/** Opens the person's 🔔 Care Hub chat in Messages, where notices arrive (decision 0007, 4.4). */
export async function openCareHubChat(page: Page) {
  await page.goto('/messages');
  const chats = page.locator('[href^="/messages/"]');
  await page
    .getByRole('link', { name: /Care Hub/ })
    .and(chats)
    .first()
    .click();
  return page.getByRole('main');
}
