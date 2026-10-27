import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { apiFor, expect } from '../_support/index.js';

/** GET /api/learning/reports/courses/:id (B4): { course, report, quizzes, dropOff, people }. */
export async function courseReport(page: Page, courseId: string) {
  const path = `/api/learning/reports/courses/${courseId}`;
  return (await apiFor(page)).get<Record<string, unknown>>(path);
}

/** CSV text as rows of cells; a quoted cell may hold commas, line breaks and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i < body.length; i++) {
    const char = body.charAt(i);
    if (quoted && char === '"' && body.charAt(i + 1) === '"') {
      cell += '"';
      i++;
    } else if (char === '"') quoted = !quoted;
    else if (!quoted && (char === ',' || char === '\n')) {
      row.push(cell);
      cell = '';
      if (char === '\n') rows.push(row.splice(0));
    } else cell += char;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

/**
 * Learning → Reports (routes.tsx: /learning/reports/courses/:courseId, /people/:personId): the
 * course report with Download CSV and Reset, and a person's transcript.
 */
export class ReportsPage {
  readonly page: Page;
  readonly main: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.getByRole('main');
  }

  /** Learning → Reports → the course, the way the checklist goes. */
  async openCourse(title: string) {
    await this.page.goto('/learning');
    await this.page.getByRole('link', { name: 'Reports' }).click();
    await this.main.getByRole('link', { name: title }).click();
    await expect(this.page).toHaveURL(/\/learning\/reports\/courses\/[\w-]+$/);
  }

  /** A learner's row in a course report, a question's row, or a course's row in a transcript. */
  row(text: string): Locator {
    return this.main.getByRole('row').filter({ hasText: text });
  }

  /** Reloads until the row shows `text`, for up to a minute (the checklist allows a reload). */
  async expectRowSoon(name: string, text: string | RegExp) {
    await expect(async () => {
      await this.page.reload();
      await expect(this.row(name)).toContainText(text, { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
  }

  /** Download CSV: the file's rows of cells, header first. */
  async downloadCsv(): Promise<string[][]> {
    const name = /download csv/i;
    const downloading = this.page.waitForEvent('download');
    await this.main.getByRole('button', { name }).or(this.main.getByRole('link', { name })).click();
    return parseCsv(await readFile(await (await downloading).path(), 'utf8'));
  }

  /** Reset next to the learner, confirmed if the screen asks; the row then says Not started. */
  async reset(name: string) {
    await this.row(name)
      .getByRole('button', { name: /^reset/i })
      .click();
    const dialog = this.page.getByRole('dialog');
    const notStarted = this.row(name).getByText(/not started/i);
    await expect(dialog.or(notStarted)).toBeVisible();
    if (await dialog.isVisible()) await dialog.getByRole('button', { name: /^reset/i }).click();
    await expect(notStarted).toBeVisible();
  }
}
