// The quiz editor in the Studio course editor: a quiz's settings, its own questions and the questions it draws
// from a bank. Each test makes a fictional draft course and bank through the API, then adds the quiz with Add
// quiz. The screen gets screenshots and the axe checks in all four projects; the flow runs once.
import type { Locator, Page } from '@playwright/test';
import {
  apiFor,
  expect,
  needs,
  onlyIn,
  signInAs,
  test,
  uniqueName,
} from '../flows/_support/index.js';
import { checkScreen } from '../support/screen-checks.js';
import { BUILDER, QUESTIONS_CSV, makeBank, questionItem } from './banks-data.js';

/** Makes a standard draft course with a unique fictional title; returns its address in the course editor. */
async function makeCourse(page: Page): Promise<string> {
  const api = await apiFor(page);
  const { course } = await api.post<{ course: { id: string } }>('/api/learning/studio/courses', {
    type: 'standard',
    title: uniqueName('Fictional quiz course'),
  });
  return `/learning/studio/courses/${encodeURIComponent(course.id)}`;
}

/** Adds a quiz with the outline's Add quiz; returns the lesson canvas, which shows the new quiz. */
async function addQuiz(page: Page): Promise<Locator> {
  await page
    .getByRole('navigation', { name: 'Outline' })
    .getByRole('button', { name: 'Add quiz', exact: true })
    .click();
  const quiz = page.getByRole('region', { name: 'Lesson: Quiz', exact: true });
  await expect(
    quiz.getByRole('heading', { level: 2, name: 'Settings', exact: true }),
  ).toBeVisible();
  return quiz;
}

/** Adds the questions of `bankTitle` to the quiz on the canvas. */
async function drawFrom(quiz: Locator, bankTitle: string): Promise<void> {
  await quiz.getByRole('button', { name: 'Add questions from a bank', exact: true }).click();
  await quiz
    .getByRole('group', { name: 'Choose a bank' })
    .getByRole('button', { name: `Add ${bankTitle}`, exact: true })
    .click();
}

/** Waits until the course editor has saved the last change: "Saving…" next to the title, then "Saved". */
async function saved(page: Page): Promise<void> {
  const main = page.getByRole('main');
  await expect(main.getByText('Saving…', { exact: true })).toBeVisible();
  await expect(main.getByText('Saved', { exact: true })).toBeVisible();
}

test.describe('Learning: quiz editor screen', () => {
  needs('signIn', 'learningStudio');

  test.beforeEach(async ({ page }) => {
    await signInAs(page, BUILDER);
  });

  test('learning-quiz-editor: a new quiz with a question and questions from a bank', async ({
    page,
  }, testInfo) => {
    const bank = await makeBank(page, QUESTIONS_CSV);
    const path = await makeCourse(page);
    const setup = async () => {
      const quiz = await addQuiz(page);
      await quiz
        .getByRole('group', { name: 'Add a question' })
        .getByRole('button', { name: 'Single answer', exact: true })
        .click();
      await drawFrom(quiz, bank.title);
      await quiz
        .getByRole('spinbutton', { name: `Questions per try from ${bank.title}`, exact: true })
        .waitFor();
    };
    await checkScreen(page, { name: 'learning-quiz-editor', path, setup }, testInfo);
  });
});

test.describe('Learning: quiz editor', () => {
  onlyIn('desktop-light');
  needs('signIn', 'learningStudio');

  test.beforeEach(async ({ page }) => {
    await signInAs(page, BUILDER);
  });

  test('keeps the pass mark, the tries, a question and a bank draw after a reload', async ({
    page,
  }) => {
    const bank = await makeBank(page, QUESTIONS_CSV);
    await page.goto(await makeCourse(page));
    const quiz = await addQuiz(page);

    // Settings: a standard course's quiz starts at 80% with unlimited tries.
    const passMark = quiz.getByRole('spinbutton', { name: 'Pass mark (%)', exact: true });
    await expect(passMark).toHaveValue('80');
    await passMark.fill('90');
    await quiz.getByRole('switch', { name: 'Unlimited tries', exact: true }).click();
    await quiz.getByRole('spinbutton', { name: 'Number of tries', exact: true }).fill('2');

    // One question of its own.
    await quiz
      .getByRole('group', { name: 'Add a question' })
      .getByRole('button', { name: 'True or false', exact: true })
      .click();
    await questionItem(page, 1)
      .getByRole('textbox', { name: 'Question', exact: true })
      .fill('Fictional calls are recorded.');

    // Questions from the bank: a new draw takes up to 5 a try, and this bank has 3.
    await drawFrom(quiz, bank.title);
    const draw = quiz.getByRole('spinbutton', {
      name: `Questions per try from ${bank.title}`,
      exact: true,
    });
    await expect(draw).toHaveValue('3');
    await expect(quiz.getByText('The bank has 3 questions.', { exact: true })).toBeVisible();
    await draw.fill('2');
    await saved(page);

    await page.reload();
    await page
      .getByRole('navigation', { name: 'Outline' })
      .getByRole('link', { name: /^\d+\. Quiz$/ })
      .click();
    const again = page.getByRole('region', { name: 'Lesson: Quiz', exact: true });
    await expect(again.getByRole('spinbutton', { name: 'Pass mark (%)', exact: true })).toHaveValue(
      '90',
    );
    await expect(
      again.getByRole('switch', { name: 'Unlimited tries', exact: true }),
    ).not.toBeChecked();
    await expect(
      again.getByRole('spinbutton', { name: 'Number of tries', exact: true }),
    ).toHaveValue('2');
    await expect(
      questionItem(page, 1).getByRole('textbox', { name: 'Question', exact: true }),
    ).toHaveValue('Fictional calls are recorded.');
    await expect(
      again.getByRole('spinbutton', { name: `Questions per try from ${bank.title}`, exact: true }),
    ).toHaveValue('2');
  });
});
