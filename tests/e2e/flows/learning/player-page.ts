import type { Browser, Locator } from '@playwright/test';
import { apiFor, expect, signInAs } from '../_support/index.js';
import { LearnerPage } from './learner-page.js';

/** The learner's progress in a course, as GET /api/learning/courses/:id/progress answers it. */
export type Progress = {
  status: string;
  acknowledgedAt?: string;
  resume?: { lessonId: string; blockId?: string };
};

/** A phone for a second device in a desktop flow (the same size as the phone projects). */
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

/** The player with its quiz and gates (Phase 1 checklist, section 2), on the learner screens. */
export class PlayerPage extends LearnerPage {
  /** The same person on a phone, in a new browser context. */
  static async onPhone(browser: Browser, who: Parameters<typeof signInAs>[1]) {
    const page = await (await browser.newContext(phone)).newPage();
    await signInAs(page, who);
    return new PlayerPage(page);
  }

  get nextButton(): Locator {
    return this.main.getByRole('button', { name: /^(next|complete)\b/i });
  }

  get retry(): Locator {
    return this.main.getByRole('button', { name: /^(retry|try again)/i });
  }

  /** The right answers, shown after an attempt when the quiz settings allow it. */
  get rightAnswers(): Locator {
    return this.main.getByText(/correct answer/i);
  }

  score(percent: number): Locator {
    return this.main.getByText(`${percent}%`);
  }

  async startQuiz() {
    await this.main.getByRole('button', { name: /^start/i }).click();
  }

  /** Picks True or False for the question with this prompt. */
  async answerTrueFalse(prompt: string, value: boolean) {
    const question = this.main.getByRole('group', { name: prompt });
    await question.getByRole('radio', { name: value ? 'True' : 'False' }).check();
  }

  async submit() {
    await this.main.getByRole('button', { name: /^submit/i }).click();
  }

  /** From My learning: the course card, then Resume if it opens the start page. */
  async resumeFromMyLearning(title: string) {
    await this.page.goto('/learning');
    await this.card(title).click();
    await expect(this.page).toHaveURL(/\/learning\/courses\/[\w-]+/);
    if (!/\/lessons\//.test(this.page.url())) {
      await this.main.getByRole('button', { name: /^(resume|continue)/i }).click();
    }
  }

  async progress(courseId: string): Promise<Progress> {
    return (await apiFor(this.page)).get<Progress>(`/api/learning/courses/${courseId}/progress`);
  }
}
