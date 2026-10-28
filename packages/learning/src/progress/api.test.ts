// The progress API schemas, checked against real reducer output.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  LearnerCourseStateSchema,
  MAX_EVENTS_PER_REQUEST,
  MAX_SECONDS_AHEAD,
  ProgressEventsRequestSchema,
  ProgressEventsResponseSchema,
  ProgressNoteRequestSchema,
  checkProgressEvents,
  progressEventsReply,
  reduceProgress,
  type LearnerCourseState,
  type ProgressEventsResponse,
  type RejectedEvent,
} from './index';
import { blocks, content, learner, makeCourse, quiz, quizLesson } from './test-helpers';

/** True only when each type is assignable to the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const overTheWire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const course = makeCourse({
  lessons: [
    content(
      'l1',
      [
        blocks.paragraph('p1'),
        blocks.check('kc1'),
        blocks.scenario('sc1'),
        blocks.continue('c1'),
        blocks.paragraph('p2'),
      ],
      { minimumSeconds: 60 },
    ),
    quiz('quiz', { maxAttempts: 3 }),
  ],
  completion: { requireQuizPass: true },
});

/** A learner partway through: refused events, a check, a scenario, a failed and an open attempt. */
function partway() {
  const l = learner();
  l.open('l1');
  l.spend('l1', 30);
  l.complete('l1');
  l.add({ type: 'lesson_opened', lessonId: 'no-such-lesson' });
  l.answer('l1', 'kc1', false);
  l.answer('l1', 'kc1');
  l.play('l1', 'sc1', ['good']);
  l.pass('l1', 'c1');
  l.spend('l1', 30);
  l.complete('l1');
  l.take(quizLesson(course, 'quiz'), 'a1', 2);
  l.start(quizLesson(course, 'quiz'), 'a2', 8);
  return l;
}

describe('LearnerCourseStateSchema', () => {
  it('has the same shape as LearnerCourseState', () => {
    const same: Same<z.infer<typeof LearnerCourseStateSchema>, LearnerCourseState> = true;
    const reply: Same<ProgressEventsResponse['rejected'][number], RejectedEvent> = true;
    expect([same, reply]).toEqual([true, true]);
  });

  it('accepts a real state sent as JSON, nested parts included', () => {
    const state = reduceProgress(course, partway().events);
    expect(state.rejected.map((rejection) => rejection.reason)).toEqual([
      'minimum_time',
      'unknown_lesson',
    ]);
    expect(state.knowledgeChecks[0]).toMatchObject({ answers: 2, firstCorrect: false });
    expect(state.scenarios[0]).toMatchObject({ outcome: 'great', passed: true });
    expect(state.quizzes[0]?.attempts).toHaveLength(1);
    expect(state.quizzes[0]?.openAttempt?.plan.attemptId).toBe('a2');

    const sent = overTheWire(state);
    expect(LearnerCourseStateSchema.parse(sent)).toEqual(sent);
  });

  it("takes a submitted attempt's right answers (0316)", () => {
    const state = reduceProgress(course, partway().events);
    const [quiz] = state.quizzes;
    const [attempt] = quiz?.attempts ?? [];
    if (!quiz || !attempt) throw new Error('Expected a submitted attempt.');
    const answered = { ...quiz, attempts: [{ ...attempt, answers: attempt.responses }] };
    const sent = overTheWire({ ...state, quizzes: [answered] });
    expect(LearnerCourseStateSchema.parse(sent)).toEqual(sent);
  });

  it('refuses a state with an unknown status or extra fields', () => {
    const sent = overTheWire(reduceProgress(course, partway().events)) as Record<string, unknown>;
    expect(LearnerCourseStateSchema.safeParse({ ...sent, status: 'done' }).success).toBe(false);
    expect(LearnerCourseStateSchema.safeParse({ ...sent, extra: true }).success).toBe(false);
  });
});

describe('ProgressEventsRequestSchema', () => {
  it('takes 1 to MAX_EVENTS_PER_REQUEST events of any shape', () => {
    const junk = Array.from({ length: MAX_EVENTS_PER_REQUEST }, (_, index) => ({ index }));
    expect(ProgressEventsRequestSchema.safeParse({ events: junk }).success).toBe(true);
    expect(ProgressEventsRequestSchema.safeParse({ events: [...junk, 1] }).success).toBe(false);
    expect(ProgressEventsRequestSchema.safeParse({ events: [] }).success).toBe(false);
    expect(ProgressEventsRequestSchema.safeParse({ events: [1], more: 1 }).success).toBe(false);
  });
});

describe('checkProgressEvents', () => {
  it('keeps valid events and refuses the rest one by one', () => {
    const good = {
      id: 'ev-1',
      at: '2026-10-27T09:00:00.000Z',
      type: 'lesson_opened',
      lessonId: 'l1',
    };
    const checked = checkProgressEvents(
      [
        good,
        { ...good, id: 'ev-2', at: 'yesterday' },
        { id: 'ev-3', type: 'teleported' },
        42,
        { ...good, id: 'x'.repeat(150) },
      ],
      good.at,
    );
    expect(checked.valid).toEqual([good]);
    expect(checked.rejected).toEqual([
      { eventId: 'ev-2', type: 'lesson_opened', at: 'yesterday', reason: 'invalid_event' },
      { eventId: 'ev-3', type: 'teleported', at: null, reason: 'invalid_event' },
      { eventId: null, type: null, at: null, reason: 'invalid_event' },
      {
        eventId: 'x'.repeat(100),
        type: 'lesson_opened',
        at: good.at,
        reason: 'invalid_event',
      },
    ]);
  });

  it("refuses events dated more than 2 minutes after the server's clock", () => {
    const now = '2026-10-27T09:00:00.000Z';
    const opened = (id: string, at: string) => ({ id, at, type: 'lesson_opened', lessonId: 'l1' });
    const late = '2026-10-27T09:02:00.001Z';
    const checked = checkProgressEvents(
      [
        opened('ev-1', '2026-10-20T09:00:00.000Z'),
        opened('ev-2', '2026-10-27T09:02:00.000Z'),
        opened('ev-3', late),
      ],
      now,
    );
    expect(MAX_SECONDS_AHEAD).toBe(120);
    expect(checked.valid.map((event) => event.id)).toEqual(['ev-1', 'ev-2']);
    expect(checked.rejected).toEqual([
      { eventId: 'ev-3', type: 'lesson_opened', at: late, reason: 'future' },
    ]);
    const reply = progressEventsReply(reduceProgress(course, checked.valid), checked);
    expect(ProgressEventsResponseSchema.safeParse(overTheWire(reply)).success).toBe(true);
    // A server clock that can't be read refuses everything instead of letting it through.
    expect(checkProgressEvents([opened('ev-4', now)], 'later').rejected[0]?.reason).toBe('future');
  });
});

describe('progressEventsReply', () => {
  it("lists this request's invalid and refused events, not older refusals", () => {
    const l = partway();
    const stored = l.events.slice();
    const tooSoon = l.complete('quiz');
    const opened = l.open('l1');
    const checked = checkProgressEvents(
      [tooSoon, opened, { id: 'ev-bad', type: 'lesson_opened' }],
      opened.at,
    );
    const state = reduceProgress(course, [...stored, ...checked.valid]);

    const reply = progressEventsReply(state, checked);
    expect(reply.rejected.map((rejection) => [rejection.eventId, rejection.reason])).toEqual([
      ['ev-bad', 'invalid_event'],
      [tooSoon.id, 'wrong_lesson_kind'],
    ]);
    expect(reply.state.rejected).toHaveLength(3);
    expect(ProgressEventsResponseSchema.safeParse(overTheWire(reply)).success).toBe(true);
  });
});

describe('ProgressNoteRequestSchema', () => {
  it('takes an optional short note, trimmed', () => {
    expect(ProgressNoteRequestSchema.parse({})).toEqual({});
    expect(ProgressNoteRequestSchema.parse({ note: '  Did the classroom version  ' })).toEqual({
      note: 'Did the classroom version',
    });
    expect(ProgressNoteRequestSchema.safeParse({ note: 'x'.repeat(501) }).success).toBe(false);
    expect(ProgressNoteRequestSchema.safeParse({ reason: 'x' }).success).toBe(false);
  });
});
