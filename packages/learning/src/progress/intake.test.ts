// One batch for POST /courses/:id/events: what is stored and what goes back to the browser.
import { describe, expect, it } from 'vitest';
import {
  MAX_EVENTS_PER_LEARNER_COURSE,
  TOO_MANY_EVENTS_MESSAGE,
  progressIntake,
  quizAttemptStart,
  reduceProgress,
} from './index';
import { blocks, content, learner, makeCourse, quiz } from './test-helpers';

const course = makeCourse({
  lessonOrder: 'sequential',
  lessons: [
    content('l1', [blocks.paragraph('p1')], { minimumSeconds: 60 }),
    quiz('quiz', { maxAttempts: 2 }),
  ],
});
/** The server's clock. */
const now = '2026-10-27T10:00:00.000Z';

function stored(result: ReturnType<typeof progressIntake>) {
  if (result.kind !== 'store') throw new Error('Expected events to store');
  return result;
}

describe('progressIntake', () => {
  it("stores each new event once and sends back the state with the batch's refusals", () => {
    const l = learner();
    const opened = l.open('l1');
    const early = l.complete('l1');
    const beat = l.add({ type: 'time_active', lessonId: 'l1', seconds: 30 }, 30);
    const ahead = { ...beat, id: 'ev-ahead', at: '2026-10-27T10:02:00.001Z' };
    const batch = [opened, beat, beat, early, ahead, { id: 'junk' }];
    const result = stored(progressIntake(course, [opened], batch, now));
    expect(result.events).toEqual([beat, early]);
    expect(result.reply.rejected.map((r) => [r.eventId, r.reason])).toEqual([
      ['ev-ahead', 'future'],
      ['junk', 'invalid_event'],
      [early.id, 'minimum_time'],
    ]);
    expect(result.reply.state).toEqual(reduceProgress(course, [opened, beat, early]));
    expect(result.reply.state.activeSeconds).toBe(30);
  });

  it('stores nothing new when a batch is sent again, and replies the same', () => {
    const l = learner();
    l.open('l1');
    l.complete('l1');
    const first = stored(progressIntake(course, [], l.events, now));
    expect(first.events).toHaveLength(2);
    expect(progressIntake(course, first.events, l.events, now)).toEqual({
      kind: 'store',
      events: [],
      reply: first.reply,
    });
  });

  it('times a submission from a clock behind the server-made start just after it', () => {
    const l = learner();
    l.open('l1');
    l.spend('l1', 60);
    l.complete('l1');
    const start = quizAttemptStart(course, l.events, {
      lessonId: 'quiz',
      attemptId: 'a1',
      eventId: 'start-1',
      seed: 3,
      at: '2026-10-27T09:30:00.000Z',
      now,
    });
    if (start.kind !== 'start') throw new Error('Expected a new attempt');
    const right = { type: 'single_choice', optionId: 'right' };
    const submitted = {
      id: 'ev-submit',
      type: 'quiz_attempt_submitted',
      lessonId: 'quiz',
      attemptId: 'a1',
      // This browser's clock is a minute behind the one that asked for the attempt.
      at: '2026-10-27T09:29:00.000Z',
      responses: Object.fromEntries(start.event.plan.questionIds.map((id) => [id, right])),
    };
    const result = stored(progressIntake(course, [...l.events, start.event], [submitted], now));
    expect(result.events).toEqual([{ ...submitted, at: '2026-10-27T09:30:00.001Z' }]);
    expect(result.reply.rejected).toEqual([]);
    expect(result.reply.state.quizzes[0]).toMatchObject({
      attemptsUsed: 1,
      passed: true,
      bestPercent: 100,
    });
  });

  it('refuses a batch that would go past the most events one course keeps', () => {
    const l = learner();
    l.open('l1');
    while (l.events.length < MAX_EVENTS_PER_LEARNER_COURSE - 1) {
      l.add({ type: 'time_active', lessonId: 'l1', seconds: 1 }, 0);
    }
    const full = l.events.slice();
    const last = l.add({ type: 'time_active', lessonId: 'l1', seconds: 1 });
    const extra = l.add({ type: 'time_active', lessonId: 'l1', seconds: 1 });
    expect(progressIntake(course, full, [last, extra], now)).toEqual({
      kind: 'too_many',
      message: TOO_MANY_EVENTS_MESSAGE,
    });
    expect(stored(progressIntake(course, full, [last, full[0]], now)).events).toEqual([last]);
  });
});
