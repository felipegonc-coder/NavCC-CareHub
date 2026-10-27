// Browser event checks and server-made quiz attempts (decisions 0302 and 0310).
import { describe, expect, it } from 'vitest';
import { planAttempt } from '../quiz/index';
import {
  checkProgressEvents,
  quizAttemptStart,
  quizSubmissionTime,
  reduceProgress,
  type ProgressEvent,
} from './index';
import { blocks, content, learner, makeCourse, quiz, quizLesson } from './test-helpers';

const course = makeCourse({
  lessonOrder: 'sequential',
  lessons: [content('l1', [blocks.paragraph('p1')]), quiz('quiz', { maxAttempts: 2 })],
});
const nine = (time: string) => `2026-10-27T09:${time}Z`;
/** The server's clock for every request below. */
const now = nine('30:00.000');
const attempt = (n: number) => ({ attemptId: `a${n}`, eventId: `start-${n}`, seed: 40 + n, now });

/** A learner who has finished lesson 1, so the quiz is open. */
function readyForQuiz() {
  const l = learner();
  l.complete('l1');
  return l;
}

describe('checkProgressEvents from a browser', () => {
  it("takes a knowledge check as right or wrong only, never the learner's answer", () => {
    const answered = {
      id: 'ev-1',
      at: nine('00:00.000'),
      type: 'knowledge_check_answered',
      lessonId: 'l1',
      blockId: 'kc1',
      correct: true,
    };
    const withAnswer = { ...answered, id: 'ev-2', response: { type: 'true_false', value: true } };
    expect(checkProgressEvents([answered, withAnswer], now)).toEqual({
      valid: [answered],
      rejected: [
        {
          eventId: 'ev-2',
          type: 'knowledge_check_answered',
          at: answered.at,
          reason: 'invalid_event',
        },
      ],
    });
  });

  it('refuses quiz_attempt_started, since only the server starts attempts', () => {
    const plan = planAttempt(quizLesson(course, 'quiz'), 7, 'a1');
    const started = { id: 'ev-1', at: nine('00:00.000'), type: 'quiz_attempt_started', plan };
    expect(checkProgressEvents([{ ...started, lessonId: 'quiz' }], now)).toEqual({
      valid: [],
      rejected: [
        { eventId: 'ev-1', type: 'quiz_attempt_started', at: started.at, reason: 'server_only' },
      ],
    });
  });
});

describe('quizAttemptStart', () => {
  it("plans a new attempt with the server's seed, at the browser's time", () => {
    const at = nine('05:00.000');
    expect(
      quizAttemptStart(course, readyForQuiz().events, { lessonId: 'quiz', ...attempt(1), at }),
    ).toEqual({
      kind: 'start',
      event: {
        id: 'start-1',
        at,
        type: 'quiz_attempt_started',
        lessonId: 'quiz',
        plan: planAttempt(quizLesson(course, 'quiz'), 41, 'a1'),
      },
    });
  });

  it('starts just after a stored event from a clock that runs ahead', () => {
    const l = learner();
    l.add({ type: 'lesson_completed', lessonId: 'l1' }, 600);
    const at = nine('05:00.000');
    const result = quizAttemptStart(course, l.events, { lessonId: 'quiz', ...attempt(1), at });
    expect(result.kind === 'start' && result.event.at).toBe(nine('10:00.001'));
  });

  it('resumes the open attempt, so a retried request gets the same paper', () => {
    const l = readyForQuiz();
    const first = quizAttemptStart(course, l.events, {
      lessonId: 'quiz',
      ...attempt(1),
      at: nine('05:00.000'),
    });
    if (first.kind !== 'start') throw new Error('Expected a new attempt');
    const again = quizAttemptStart(course, [...l.events, first.event], {
      lessonId: 'quiz',
      ...attempt(2),
      at: nine('06:00.000'),
    });
    expect(again).toEqual({ kind: 'resume', plan: first.event.plan, startedAt: first.event.at });
  });

  it("refuses a start dated more than 2 minutes after the server's clock", () => {
    const events = readyForQuiz().events;
    const start = (at: string) =>
      quizAttemptStart(course, events, { lessonId: 'quiz', ...attempt(1), at });
    expect(start(nine('32:00.000')).kind).toBe('start');
    expect(start(nine('32:00.001'))).toEqual({
      kind: 'refused',
      rejection: {
        eventId: 'start-1',
        type: 'quiz_attempt_started',
        at: nine('32:00.001'),
        reason: 'future',
      },
    });
  });

  it('refuses unknown lessons, content lessons, locked quizzes and used-up attempts', () => {
    const reason = (events: readonly ProgressEvent[], lessonId: string, n = 1) => {
      const result = quizAttemptStart(course, events, {
        lessonId,
        ...attempt(n),
        at: nine('30:00.000'),
      });
      return result.kind === 'refused' ? result.rejection.reason : result.kind;
    };
    expect(reason([], 'nope')).toBe('unknown_lesson');
    expect(reason([], 'l1')).toBe('wrong_lesson_kind');
    expect(reason([], 'quiz')).toBe('locked');

    const l = readyForQuiz();
    l.take(quizLesson(course, 'quiz'), 'a1', 0);
    l.take(quizLesson(course, 'quiz'), 'a2', 0, 8);
    expect(reason(l.events, 'quiz', 3)).toBe('no_attempts_left');
  });
});

describe('quizSubmissionTime', () => {
  it('moves a submission from a clock behind the start to just after it, so it counts', () => {
    const l = readyForQuiz();
    const started = quizAttemptStart(course, l.events, {
      lessonId: 'quiz',
      ...attempt(1),
      at: nine('05:00.000'),
    });
    if (started.kind !== 'start') throw new Error('Expected a new attempt');
    const stored = [...l.events, started.event];
    const state = reduceProgress(course, stored);
    const submission = { lessonId: 'quiz', attemptId: 'a1', at: nine('04:00.000') };
    expect(quizSubmissionTime(state, submission)).toBe(nine('05:00.001'));
    const later = { ...submission, at: nine('06:00.000') };
    expect(quizSubmissionTime(state, later)).toBe(later.at);
    const otherAttempt = { ...submission, attemptId: 'a9' };
    expect(quizSubmissionTime(state, otherAttempt)).toBe(submission.at);

    const right = { type: 'single_choice', optionId: 'right' };
    const responses = Object.fromEntries(started.event.plan.questionIds.map((id) => [id, right]));
    const submitted = {
      id: 'ev-submit',
      type: 'quiz_attempt_submitted',
      lessonId: 'quiz',
      attemptId: 'a1',
      responses,
      at: quizSubmissionTime(state, submission),
    };
    const after = reduceProgress(course, [...stored, submitted]);
    expect(after.rejected).toEqual([]);
    expect(after.quizzes[0]).toMatchObject({ attemptsUsed: 1, passed: true, bestPercent: 100 });
  });
});
