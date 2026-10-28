import {
  planAttempt,
  sampleCertificationCourse,
  type Course,
  type ProgressEvent,
  type QuizLesson,
} from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import { NO_PROGRESS, type ProgressRow } from '../progress/store';
import { summarizeRuns, surveyLessonOf, type CourseRun } from './surveys';

// Fictional data only. The certification sample's survey asks how useful the course was (single choice) and
// what people want more of (multiple choice); here its lessons can be taken in any order.
const live: Course = {
  ...sampleCertificationCourse,
  settings: { ...sampleCertificationCourse.settings, lessonOrder: 'free' },
};
const survey = surveyLessonOf(live, 'esc-feedback');

/** Version 1 of the course, when the survey only asked how useful it was. */
const firstVersion: Course = {
  ...live,
  lessons: live.lessons.map((lesson) =>
    lesson.id === survey.id ? { ...survey, questions: survey.questions.slice(0, 1) } : lesson,
  ),
};

let clock = Date.parse('2026-10-27T09:00:00.000Z');
const nextAt = () => new Date((clock += 1000)).toISOString();

function started(lesson: QuizLesson, attemptId: string): ProgressEvent {
  return {
    id: `${attemptId}-start`,
    at: nextAt(),
    type: 'quiz_attempt_started',
    lessonId: lesson.id,
    plan: planAttempt(lesson, 7, attemptId),
  };
}

/** Starts and submits the survey: how useful (an option id) and, when given, what they want more of. */
function took(lesson: QuizLesson, attemptId: string, useful: string, more?: string[]) {
  const start = started(lesson, attemptId);
  const submitted: ProgressEvent = {
    id: `${attemptId}-submit`,
    at: nextAt(),
    type: 'quiz_attempt_submitted',
    lessonId: lesson.id,
    attemptId,
    responses: {
      'esc-survey-useful': { type: 'single_choice', optionId: useful },
      ...(more ? { 'esc-survey-more': { type: 'multiple_choice', optionIds: more } } : {}),
    },
  };
  return [start, submitted];
}

function run(learnerId: string, version: number, events: ProgressEvent[]): CourseRun {
  const at = new Date('2026-10-27T09:00:00.000Z');
  const row: ProgressRow = {
    ...NO_PROGRESS,
    workspaceId: 'workspace-harbor-lane',
    learnerId,
    courseId: live.id,
    run: 1,
    runStartedAt: at,
    version,
    markedCompleteAt: null,
    previousFinishedAt: null,
    createdAt: at,
    updatedAt: at,
  };
  return { row, events };
}

/** What `find` throws, or undefined. */
function thrown(find: () => unknown): unknown {
  try {
    find();
  } catch (error) {
    return error;
  }
  return undefined;
}

const versions = (byNumber: Record<number, Course>) => async (version: number) =>
  byNumber[version] ?? null;

describe('summarizeRuns', () => {
  it("counts each learner's survey answers, without names", async () => {
    const summary = await summarizeRuns(
      survey,
      [
        run('learner-ana', 2, took(survey, 'a1', 'very', ['examples', 'practice'])),
        run('learner-ben', 2, took(survey, 'b1', 'very', ['practice'])),
        run('learner-cy', 2, took(survey, 'c1', 'not', ['videos'])),
        run('learner-dee', 2, [started(survey, 'd1')]),
        run('learner-eli', 2, []),
      ],
      versions({ 2: live }),
    );

    expect(summary.lessonId).toBe('esc-feedback');
    expect(summary.submissions).toBe(3);
    const [useful, more] = summary.questions;
    expect(useful).toMatchObject({ questionId: 'esc-survey-useful', answered: 3 });
    expect(useful?.answers.map(({ text, count, percent }) => [text, count, percent])).toEqual([
      ['Very useful', 2, 67],
      ['Somewhat useful', 0, 0],
      ['Not useful', 1, 33],
    ]);
    expect(more).toMatchObject({ questionId: 'esc-survey-more', answered: 3 });
    expect(more?.answers.map(({ optionId, count }) => [optionId, count])).toEqual([
      ['examples', 1],
      ['practice', 2],
      ['videos', 1],
    ]);
    expect(JSON.stringify(summary)).not.toMatch(/learner-/);
  });

  it('reads each run against the course version it is pinned to', async () => {
    const summary = await summarizeRuns(
      survey,
      [
        run('learner-ana', 2, took(survey, 'a1', 'very', ['practice'])),
        run('learner-fay', 1, took(surveyLessonOf(firstVersion, survey.id), 'f1', 'somewhat')),
        run('learner-gus', 3, took(survey, 'g1', 'not', ['videos'])),
      ],
      versions({ 1: firstVersion, 2: live }),
    );

    // Version 3 can't be read, so Gus is left out; Fay's version didn't ask the second question.
    expect(summary.submissions).toBe(2);
    expect(summary.questions.map((question) => question.answered)).toEqual([2, 1]);
    expect(summary.questions[0]?.answers.map((answer) => answer.count)).toEqual([1, 1, 0]);
  });

  it('leaves out attempts made while the lesson was a graded quiz', async () => {
    const graded: Course = {
      ...live,
      lessons: live.lessons.map((lesson) =>
        lesson.id === survey.id
          ? { ...survey, settings: { ...survey.settings, mode: 'graded' as const } }
          : lesson,
      ),
    };
    const gradedLesson = graded.lessons.find((lesson) => lesson.id === survey.id) as QuizLesson;
    const summary = await summarizeRuns(
      survey,
      [run('learner-hal', 1, took(gradedLesson, 'h1', 'very', ['practice']))],
      versions({ 1: graded, 2: live }),
    );
    expect(summary.submissions).toBe(0);
    expect(summary.questions.every((question) => question.answered === 0)).toBe(true);
  });
});

describe('surveyLessonOf', () => {
  it('finds survey lessons only, with a plain 404 otherwise', () => {
    expect(surveyLessonOf(live, 'esc-feedback').title).toBe('Tell us what you think');
    expect(() => surveyLessonOf(live, 'esc-exam')).toThrow(
      'This lesson is a graded quiz, so it has no survey results.',
    );
    expect(() => surveyLessonOf(live, 'esc-routes')).toThrow("This survey isn't in the course.");
    expect(thrown(() => surveyLessonOf(live, 'nowhere'))).toMatchObject({ status: 404 });
  });
});
