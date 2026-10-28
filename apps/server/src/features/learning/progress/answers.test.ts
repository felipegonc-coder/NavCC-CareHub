import { randomUUID } from 'node:crypto';
import {
  planAttempt,
  questionAnalysis,
  richText,
  sampleStandardCourse,
  type Course,
  type ProgressEvent,
  type QuestionResponse,
  type QuizLesson,
} from '@carehub/learning';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../../db';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import { listQuizAnswers, quizAnswersOf } from './answers';
import { learningProgress, learningProgressEvents } from './schema';
import { bindMemoryCourseVersions, type MemoryCourseVersions } from './testing';

// Fictional people and courses only: the standard sample's final quiz, then a one-question survey.
const QUIZ = 'calls-quiz';
const SURVEY = 'calls-survey';

const surveyLesson = (questionId: string): QuizLesson => ({
  id: SURVEY,
  kind: 'quiz',
  title: 'Tell us what you think',
  settings: {
    passMark: 0,
    maxAttempts: null,
    shuffleQuestions: false,
    shuffleOptions: false,
    revealAnswers: 'never',
    mode: 'survey',
  },
  questions: [
    {
      id: questionId,
      type: 'single_choice',
      prompt: richText('How useful was this course?'),
      points: 1,
      options: [
        { id: 'very', text: 'Very useful', correct: false },
        { id: 'not', text: 'Not useful', correct: false },
      ],
    },
  ],
});

const withSurvey = (questionId = 'survey-useful'): Course => ({
  ...structuredClone(sampleStandardCourse),
  lessons: [...structuredClone(sampleStandardCourse.lessons), surveyLesson(questionId)],
});

function quizIn(course: Course, lessonId: string): QuizLesson {
  const lesson = course.lessons.find((candidate) => candidate.id === lessonId);
  if (lesson?.kind !== 'quiz') throw new Error(`A quiz lesson ${lessonId} expected.`);
  return lesson;
}

let clock = Date.parse('2026-10-20T09:00:00.000Z');
const tick = () => new Date((clock += 1000)).toISOString();

/** An attempt started on the server and, with responses, submitted. */
function attempt(
  course: Course,
  lessonId: string,
  attemptId: string,
  responses?: Record<string, QuestionResponse>,
): ProgressEvent[] {
  const plan = planAttempt(quizIn(course, lessonId), 7, attemptId);
  const started: ProgressEvent = {
    id: randomUUID(),
    at: tick(),
    type: 'quiz_attempt_started',
    lessonId,
    plan,
  };
  if (!responses) return [started];
  return [
    started,
    {
      id: randomUUID(),
      at: tick(),
      type: 'quiz_attempt_submitted',
      lessonId,
      attemptId,
      responses,
    },
  ];
}

const submittedAt = (list: readonly ProgressEvent[]) =>
  list.find((event) => event.type === 'quiz_attempt_submitted')?.at;

const firstWrong: Record<string, QuestionResponse> = {
  'calls-q-first': { type: 'single_choice', optionId: 'email' },
  'calls-q-interrupt': { type: 'true_false', value: false },
};

describe('quizAnswersOf', () => {
  const course = withSurvey();
  const row = { learnerId: 'learner-ada', version: 1, markedCompleteAt: null };

  it('lists the submitted attempts per quiz in course order, with their results', () => {
    const survey = attempt(course, SURVEY, 'survey-1', {
      'survey-useful': { type: 'single_choice', optionId: 'very' },
    });
    const first = attempt(course, QUIZ, 'quiz-1', firstWrong);
    const open = attempt(course, QUIZ, 'quiz-2');
    const answers = quizAnswersOf(course, row, [...survey, ...first, ...open]);

    expect(answers).toMatchObject([
      { learnerId: 'learner-ada', lessonId: QUIZ, mode: 'graded', version: 1 },
      { learnerId: 'learner-ada', lessonId: SURVEY, mode: 'survey', version: 1 },
    ]);
    const [quiz, poll] = answers;
    expect(quiz?.attempts.map((sent) => [sent.attemptId, sent.submittedAt])).toEqual([
      ['quiz-1', submittedAt(first)],
    ]);
    const results = quiz?.attempts[0]?.results ?? [];
    expect(results.map((result) => [result.questionId, result.answered, result.correct])).toEqual([
      ['calls-q-first', true, false],
      ['calls-q-close', false, false],
      ['calls-q-interrupt', true, true],
      ['calls-q-terms', false, false],
      ['calls-q-order', false, false],
    ]);
    expect(results[0]?.picked).toEqual(['email']);
    // A survey has no right answers, but keeps what was picked.
    expect(poll?.attempts[0]?.results).toMatchObject([
      { questionId: 'survey-useful', answered: true, correct: false, picked: ['very'] },
    ]);
  });

  it('feeds question analysis as it is', () => {
    const answers = quizAnswersOf(course, row, [
      ...attempt(course, QUIZ, 'quiz-1', firstWrong),
      ...attempt(course, QUIZ, 'quiz-2', {
        'calls-q-first': { type: 'single_choice', optionId: 'record' },
      }),
    ]);
    const attempts = answers.flatMap((quiz) => quiz.attempts);
    expect(attempts).toHaveLength(2);
    const [first] = questionAnalysis(quizIn(course, QUIZ), attempts).filter(
      (entry) => entry.questionId === 'calls-q-first',
    );
    expect(first).toMatchObject({
      answered: 2,
      correct: 1,
      percentCorrect: 50,
      wrongPicks: [{ id: 'email', text: 'Your email', count: 1 }],
    });
  });

  it('has nothing for a learner without a submitted attempt', () => {
    expect(quizAnswersOf(course, row, [])).toEqual([]);
    expect(quizAnswersOf(course, row, attempt(course, QUIZ, 'quiz-1'))).toEqual([]);
  });
});

describe.skipIf(!hasDatabase)('listQuizAnswers on Postgres', () => {
  let server: TestApp;
  let db: Db;
  let courses: MemoryCourseVersions;
  const unbind: (() => void)[] = [];

  beforeAll(async () => {
    server = await createTestApp();
    db = server.db;
    const memory = bindMemoryCourseVersions();
    ({ courses } = memory);
    unbind.push(memory.unbind);
  });

  afterAll(async () => {
    for (const done of unbind) done();
    await server?.close();
  });

  it('reads each current run in the course on the version it is measured against', async () => {
    const workspaceId = randomUUID();
    const v1 = { ...withSurvey(), id: `course-${randomUUID()}` };
    const v2 = { ...withSurvey('survey-useful-2'), id: v1.id };
    expect(courses.publish(workspaceId, v1)).toBe(1);
    expect(courses.publish(workspaceId, v2)).toBe(2);
    const here = { workspaceId, courseId: v1.id };

    /** A progress row whose current run is the last of `runs`, with the runs' events. */
    async function learner(
      learnerId: string,
      row: { version: number; attempts: number },
      runs: ProgressEvent[][] = [],
      where = here,
    ) {
      await db
        .insert(learningProgress)
        .values({ ...where, learnerId, ...row, run: Math.max(runs.length, 1) });
      const values = runs.flatMap((list, index) =>
        list.map((event) => ({ ...where, learnerId, eventId: event.id, run: index + 1, event })),
      );
      if (values.length > 0) await db.insert(learningProgressEvents).values(values);
    }

    const [ada, bo, cy, dee] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    // Ada was reset after her first attempt; only the attempt since counts.
    const before = attempt(v1, QUIZ, 'ada-1', firstWrong);
    const since = attempt(v1, QUIZ, 'ada-2', firstWrong);
    await learner(ada, { version: 1, attempts: 1 }, [before, since]);
    // Bo's run is on version 2, whose survey question has another id.
    const poll = attempt(v2, SURVEY, 'bo-1', {
      'survey-useful-2': { type: 'single_choice', optionId: 'not' },
    });
    await learner(bo, { version: 2, attempts: 1 }, [poll]);
    // Cy only opened an attempt; Dee's version can't be found.
    await learner(cy, { version: 1, attempts: 0 }, [attempt(v1, QUIZ, 'cy-1')]);
    await learner(dee, { version: 9, attempts: 1 });
    // Ada's attempts elsewhere don't count here.
    const elsewhere = [attempt(v1, QUIZ, 'other-1', firstWrong)];
    await learner(ada, { version: 1, attempts: 1 }, elsewhere, { ...here, courseId: 'course-x' });
    await learner(ada, { version: 1, attempts: 1 }, elsewhere, { ...here, workspaceId: bo });

    const answers = await listQuizAnswers(db, workspaceId, v1.id);
    const sent = answers.map(({ attempts, ...quiz }) => ({
      ...quiz,
      attempts: attempts.map((one) => [one.attemptId, one.submittedAt]),
    }));
    expect(sent).toEqual(
      [
        {
          learnerId: ada,
          lessonId: QUIZ,
          mode: 'graded',
          version: 1,
          attempts: [['ada-2', submittedAt(since)]],
        },
        {
          learnerId: bo,
          lessonId: SURVEY,
          mode: 'survey',
          version: 2,
          attempts: [['bo-1', submittedAt(poll)]],
        },
      ].sort((a, b) => (a.learnerId < b.learnerId ? -1 : 1)),
    );
    const boAnswers = answers.find((quiz) => quiz.learnerId === bo);
    expect(boAnswers?.attempts[0]?.results).toMatchObject([
      { questionId: 'survey-useful-2', picked: ['not'] },
    ]);
  });
});
