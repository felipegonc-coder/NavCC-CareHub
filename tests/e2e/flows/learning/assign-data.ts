import type { Locator, Page } from '@playwright/test';
import { DEFAULT_TIME_ZONE, apiFor, shownDate } from '../_support/index.js';

/**
 * Assignments and due dates for the Learning flows (docs/learning/api.md, assignments; request
 * shape from packages/learning/src/delivery/api.ts). It lives only here, in `assign()`.
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

/** Whole days from today to a calendar day. */
export const daysUntil = (isoDay: string) =>
  Math.round((Date.parse(`${isoDay}T12:00:00Z`) - Date.parse(`${day()}T12:00:00Z`)) / 86_400_000);

/** How the "New course assigned" notice words a due date (learning/src/delivery/notices.ts). */
export function dueWords(isoDay: string): string {
  const days = daysUntil(isoDay);
  if (days === 0) return 'due today';
  return days === 1 ? 'due tomorrow' : `due in ${days} days`;
}

/** A calendar day the way the app shows it, for example "Oct 30, 2026". */
export const shownDay = (isoDay: string) => shownDate(new Date(`${isoDay}T12:00:00Z`));

/** Where a course's start page is, and links to it from notices, the calendar or Home. */
export const courseUrl = (courseId: string) => new RegExp(`/learning/courses/${courseId}$`);
export const linkToCourse = (scope: Page | Locator, courseId: string) =>
  scope.locator(`a[href$="/learning/courses/${courseId}"]`);

/** POST /api/learning/assignments for one course; a due date can't be before today. */
export const assignBody = (
  courseId: string,
  to: { people?: string[]; groups?: string[]; dueDate?: string },
) => ({
  target: { type: 'course', id: courseId },
  people: to.people ?? [],
  groups: to.groups ?? [],
  ...(to.dueDate === undefined ? {} : { dueDate: to.dueDate }),
});

/** An assignment as the API answers it; only what the flows read. */
export type Assignment = { id: string; courseId: string; dueDate?: string | null };

/** Assigns a course to people and groups, as the signed-in builder: one assignment. */
export async function assign(
  page: Page,
  courseId: string,
  to: Parameters<typeof assignBody>[1],
): Promise<Assignment> {
  const api = await apiFor(page);
  const made = await api.post<Assignment[]>('/api/learning/assignments', assignBody(courseId, to));
  if (!made[0]) throw new Error(`No assignment came back for course ${courseId}`);
  return made[0];
}

// The e2e test hooks (decision 0007, routes under /api/<lane>/test/), there only when the e2e
// server runs with CAREHUB_TEST_HOOKS=1.

/**
 * Moves an assignment's due date to any day, a past one too, which the API itself refuses
 * (`learningTestHooks`). It needs learning.assign, so a builder such as Tara calls it.
 */
export async function setDueDate(page: Page, assignmentId: string, dueDate: string) {
  const api = await apiFor(page);
  return api.post<Assignment>(`/api/learning/test/assignments/${assignmentId}`, { dueDate });
}

/**
 * Runs the hourly reminders job through the jobs' hook (`jobsTestHooks`), POST
 * /api/jobs/test/periodic/learning.reminders, as if it were midday on `isoDay` in Care Hub's time
 * zone (it sends only from 8:00 to 20:00). Only a site admin may run a job, so `page` is Avery's.
 * It reaches everyone's assignments, not just the test's, so checks look for their own course's
 * notices in the 🔔 Care Hub chat.
 */
export async function runReminders(page: Page, isoDay: string): Promise<void> {
  const api = await apiFor(page);
  const now = `${isoDay}T18:00:00Z`; // 12:00 in Denver in summer time, 11:00 in winter
  await api.post<{ task: string; now: string }>('/api/jobs/test/periodic/learning.reminders', {
    now,
  });
}

/** Opens the person's 🔔 Care Hub chat in Messages, where notices arrive (decision 0007, 4.4). */
export async function openCareHubChat(page: Page) {
  await page.goto('/messages');
  await page
    .getByRole('link', { name: /^Care Hub/ })
    .and(page.locator('[href$="/messages/care-hub"]'))
    .first()
    .click();
  return page.getByRole('main');
}
