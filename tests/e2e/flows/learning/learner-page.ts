import type { Locator, Page } from '@playwright/test';
import { DEFAULT_TIME_ZONE, apiFor, expect, shownDate } from '../_support/index.js';

/** What the screens say when a link is wrong or the person may not see something (api.md). */
export const NOT_FOUND = 'This was deleted, or the link is wrong.';
export const NO_ACCESS = /you don.t have access/i;

/**
 * A day the way Learning shows it to the person signed in on `page`, for example "Oct 27, 2026":
 * in their profile's time zone, or Care Hub's when the profile has none (decision 0317). Never the
 * browser's.
 */
export async function shownDayIn(page: Page, at: Date): Promise<string> {
  const { user } = await (
    await apiFor(page)
  ).get<{ user: { timeZone?: string | null } }>('/api/auth/me');
  return shownDate(at, user.timeZone ?? DEFAULT_TIME_ZONE);
}

/**
 * The learner's screens: My learning (/learning), the Catalog, a course's start page and the
 * player. Button names are the defaults of the course format's labels (Start, Next, Submit…).
 */
export class LearnerPage {
  readonly page: Page;
  readonly main: Locator;
  readonly outline: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.getByRole('main');
    this.outline = page.getByRole('navigation', { name: /outline/i });
  }

  /** Learning → Catalog, optionally searched. */
  async catalog(search?: string) {
    await this.page.goto('/learning/catalog');
    await expect(this.page.getByRole('heading', { level: 1, name: 'Catalog' })).toBeVisible();
    if (search) await this.main.getByRole('searchbox').fill(search);
  }

  /** A course card (or row) that links to the course. */
  card(title: string): Locator {
    return this.main.getByRole('link', { name: title });
  }

  /** Opens the start page and starts (or resumes) the course. */
  async start(courseId: string) {
    await this.page.goto(`/learning/courses/${courseId}`);
    const start = /^(start|resume|continue)/i;
    await this.main
      .getByRole('button', { name: start })
      .or(this.main.getByRole('link', { name: start }))
      .click();
    await expect(this.page).toHaveURL(/\/lessons\/[\w-]+/);
  }

  /** The lesson's own heading in the player. */
  lessonHeading(title: string): Locator {
    return this.main.getByRole('heading', { name: title });
  }

  /** Next (or Complete) at the end of a lesson. */
  async next() {
    await this.main.getByRole('button', { name: /^(next|complete)\b/i }).click();
  }
}
