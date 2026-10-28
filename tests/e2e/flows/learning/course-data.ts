import type { Browser, Page } from '@playwright/test';
import { apiFor, signInAs, uniqueName } from '../_support/index.js';
import type { AuthoredQuestion } from './studio-page.js';

/**
 * Courses for the Learning flows, made through the Learning API (docs/learning/api.md) in the
 * course format of docs/learning/course-format.md. Fictional content only.
 */

/** Tara Trainer from the Learning seed: role Trainer (Editor plus build, assign and analytics). */
export const TARA = 'tara.trainer@example.test';

/** Remy Reports from the Learning seed (#252): role Report viewer, with only analytics. */
export const REMY = 'remy.reports@example.test';

/** A new page in its own browser context, signed in as this person (a second person in a flow). */
export async function pageFor(browser: Browser, who: Parameters<typeof signInAs>[1]) {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, who);
  return page;
}

export type Json = { [key: string]: unknown };
export type Lesson = Json & { id: string; kind: 'content' | 'quiz'; title: string };
export type Course = Json & { id: string; title: string; settings: Json; lessons: Lesson[] };
type Draft = { course: Course; revision: unknown };

/** Rich text with one paragraph. */
export const rich = (text: string) => [{ runs: [{ text }] }];

export const paragraph = (id: string, text: string): Json => ({
  id,
  type: 'paragraph',
  text: rich(text),
});

/** A content lesson with one paragraph; `extra` adds or replaces fields (blocks, minimumSeconds). */
export function content(id: string, title: string, extra: Json = {}): Lesson {
  return {
    id,
    kind: 'content',
    title,
    blocks: [paragraph(`${id}-text`, `Fictional QA reading for ${title}.`)],
    ...extra,
  };
}

const feedback = { correct: rich('Right, well done.'), incorrect: rich('Not quite. Try again.') };

/** A single or multiple choice question: the right options first, then the wrong ones. */
export function choice(
  id: string,
  prompt: string,
  right: string[],
  wrong: string[],
  type: 'single_choice' | 'multiple_choice' = 'single_choice',
): Json {
  const options = [...right, ...wrong].map((text, i) => ({
    id: `${id}-o${i + 1}`,
    text,
    correct: i < right.length,
  }));
  return { id, type, points: 1, prompt: rich(prompt), feedback, options };
}

export const trueFalse = (id: string, prompt: string, answer: boolean): Json => ({
  id,
  type: 'true_false',
  points: 1,
  prompt: rich(prompt),
  feedback,
  answer,
});

/** A matching question: each item and its match. */
export function matching(id: string, prompt: string, pairs: Record<string, string>): Json {
  const shaped = Object.entries(pairs).map(([item, match], i) => ({
    id: `${id}-p${i + 1}`,
    prompt: item,
    match,
  }));
  return { id, type: 'matching', points: 1, prompt: rich(prompt), feedback, pairs: shaped };
}

/** A graded quiz lesson: pass mark 80, unlimited tries, answers after each try, no shuffling. */
export function quiz(id: string, title: string, questions: Json[], settings: Json = {}): Lesson {
  return {
    id,
    kind: 'quiz',
    title,
    questions,
    settings: {
      passMark: 80,
      maxAttempts: null,
      shuffleQuestions: false,
      shuffleOptions: false,
      revealAnswers: 'after_each_attempt',
      ...settings,
    },
  };
}

/** The final quiz of the Phase 1 checklist: five questions of the P1 types, one of them matching. */
export const PHASE_ONE_QUIZ: AuthoredQuestion[] = [
  { type: 'Single choice', prompt: 'What do you do first?', right: ['Greet'], wrong: ['Hold'] },
  { type: 'Multiple answers', prompt: 'What confirms a caller?', right: ['ID'], wrong: ['Mood'] },
  { type: 'True/false', prompt: "You may share one caller's details with another.", answer: false },
  { type: 'Matching', prompt: 'Match each step.', pairs: { Greeting: 'Start', Summary: 'End' } },
  {
    type: 'Single choice',
    prompt: 'When do you check on a hold?',
    right: ['Often'],
    wrong: ['Never'],
  },
];

/** The same questions in the course format, with ids q1 to q5. */
export const fiveQuestions = (): Json[] =>
  PHASE_ONE_QUIZ.map((question, i) => {
    const id = `q${i + 1}`;
    if (question.type === 'True/false') return trueFalse(id, question.prompt, question.answer);
    if (question.type === 'Matching') return matching(id, question.prompt, question.pairs);
    const type = question.type === 'Single choice' ? 'single_choice' : 'multiple_choice';
    return choice(id, question.prompt, question.right, question.wrong, type);
  });

/** A draft course with these lessons, made by the signed-in builder; listed in the catalog. */
export async function draftCourse(
  page: Page,
  lessons: Lesson[],
  options: { title?: string; type?: string; settings?: Json } = {},
): Promise<Course> {
  const api = await apiFor(page);
  const title = options.title ?? uniqueName('Fictional QA course');
  const made = await api.post<Draft>('/api/learning/studio/courses', {
    type: options.type ?? 'standard',
    title,
  });
  const requireQuizPass = lessons.some((lesson) => lesson.kind === 'quiz');
  const course: Course = {
    ...made.course,
    title,
    lessons,
    settings: {
      ...made.course.settings,
      completion: { requireAllLessons: true, requireQuizPass, requireAcknowledgement: false },
      catalog: { listed: true },
      ...options.settings,
    },
  };
  await api.put(`/api/learning/studio/courses/${course.id}`, { course, revision: made.revision });
  return course;
}

/** Changes the draft of a course and saves it with the latest revision. */
export async function editCourse(page: Page, id: string, change: (course: Course) => Course) {
  const api = await apiFor(page);
  const { course, revision } = await api.get<Draft>(`/api/learning/studio/courses/${id}`);
  await api.put(`/api/learning/studio/courses/${id}`, { course: change(course), revision });
}

/** Publishes the draft without telling anyone; returns the new version number. */
export async function publish(page: Page, id: string): Promise<number> {
  const api = await apiFor(page);
  const path = `/api/learning/studio/courses/${id}/publish`;
  const { version } = await api.post<{ version: number }>(path, { notify: 'none' });
  return version;
}

/** A published course with these lessons. */
export async function liveCourse(
  page: Page,
  lessons: Lesson[],
  options: { title?: string; type?: string; settings?: Json } = {},
): Promise<Course> {
  const course = await draftCourse(page, lessons, options);
  await publish(page, course.id);
  return course;
}
