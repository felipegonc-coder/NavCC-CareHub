import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';

/** A question as the builder types it in the quiz editor. */
export type AuthoredQuestion =
  | { type: 'Single choice' | 'Multiple answers'; prompt: string; right: string[]; wrong: string[] }
  | { type: 'True/false'; prompt: string; answer: boolean }
  | { type: 'Matching'; prompt: string; pairs: Record<string, string> };

/**
 * The Studio screens (/learning/studio). Names come from the Learning Phase 1 test checklist where
 * it gives them (Studio, Preview, 📱 Phone, Publish, Minimum time). The others are the plain names
 * we expect; they live only here, so matching the screens once they land touches this file only.
 */
export class StudioPage {
  readonly page: Page;
  readonly main: Locator;
  readonly outline: Locator;
  readonly courseTitle: Locator;
  readonly saved: Locator;
  readonly published: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.getByRole('main');
    this.outline = this.main.getByRole('navigation', { name: /outline/i });
    this.courseTitle = this.main.getByRole('textbox', { name: /course title/i });
    this.saved = this.main.getByText(/^(all changes )?saved/i);
    this.published = page.getByText(/^published/i).first();
  }

  async open(courseId?: string) {
    await this.page.goto(courseId ? `/learning/studio/courses/${courseId}` : '/learning/studio');
  }

  /** New course → a type → a title → Create, which opens the course editor. */
  async newCourse(title: string, type = 'Standard') {
    await this.main.getByRole('button', { name: /new course/i }).click();
    const dialog = this.page.getByRole('dialog');
    await dialog.getByRole('radio', { name: new RegExp(`^${type}`, 'i') }).check();
    await dialog.getByRole('textbox', { name: /title/i }).fill(title);
    await dialog.getByRole('button', { name: /^create/i }).click();
    await expect(this.page).toHaveURL(/\/learning\/studio\/courses\/[\w-]+$/);
  }

  lesson(title: string): Locator {
    return this.outline.getByRole('link', { name: title });
  }

  /** Adds a lesson (or the quiz) at the end of the outline and names it. */
  async addLesson(title: string, kind: 'lesson' | 'quiz' = 'lesson') {
    await this.outline.getByRole('button', { name: new RegExp(`add ${kind}`, 'i') }).click();
    await this.main.getByRole('textbox', { name: /lesson title/i }).fill(title);
    await expect(this.lesson(title)).toBeVisible();
  }

  /** Adds a block from the block picker at the end of the open lesson. */
  async addBlock(name: string) {
    await this.main
      .getByRole('button', { name: /add block/i })
      .last()
      .click();
    await this.page.getByRole('menuitem', { name }).click();
  }

  async setMinimumTime(seconds: number) {
    await this.main.getByRole('spinbutton', { name: /minimum time/i }).fill(String(seconds));
  }

  /** Adds a question to the open quiz: the prompt, then each option (and its tick) or pair. */
  async addQuestion(question: AuthoredQuestion) {
    await this.main.getByRole('button', { name: /add question/i }).click();
    await this.page.getByRole('menuitem', { name: question.type }).click();
    const editor = this.main.getByRole('group', { name: /^question \d+/i }).last();
    await editor.getByRole('textbox', { name: /^question$/i }).fill(question.prompt);
    if (question.type === 'True/false') {
      await editor.getByRole('radio', { name: question.answer ? 'True' : 'False' }).check();
    } else if (question.type === 'Matching') {
      for (const [i, [item, match]] of Object.entries(question.pairs).entries()) {
        await editor.getByRole('textbox', { name: `Item ${i + 1}` }).fill(item);
        await editor.getByRole('textbox', { name: `Match ${i + 1}` }).fill(match);
      }
    } else {
      const options = [...question.right, ...question.wrong];
      for (const [i, text] of options.entries()) {
        await editor.getByRole('textbox', { name: `Option ${i + 1}` }).fill(text);
        if (i < question.right.length) {
          await editor
            .getByRole('checkbox', { name: /correct/i })
            .nth(i)
            .check();
        }
      }
    }
  }

  /** Publish. When a dialog asks whom to tell about the new version, nobody is told. */
  async publish() {
    await this.main.getByRole('button', { name: 'Publish' }).click();
    const dialog = this.page.getByRole('dialog');
    await expect(dialog.or(this.published)).toBeVisible();
    if (await dialog.isVisible()) {
      await dialog.getByRole('radio', { name: /don.t tell/i }).check();
      await dialog.getByRole('button', { name: 'Publish' }).click();
    }
    await expect(this.published).toBeVisible();
  }

  /** Preview → 📱 Phone. */
  async previewOnPhone() {
    await this.main.getByRole('link', { name: 'Preview' }).click();
    await expect(this.page).toHaveURL(/\/preview$/);
    await this.page.getByRole('radio', { name: /phone/i }).check();
  }
}
