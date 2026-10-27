import { describe, expect, it } from 'vitest';
import { MAX_ACTIVE_SECONDS_PER_EVENT, reduceProgress } from './index';
import { blocks, content, learner, makeCourse, quiz, quizLesson } from './test-helpers';

const course = makeCourse({
  completion: { requireAllLessons: true, requireQuizPass: true },
  lessons: [
    content('l1', [blocks.paragraph('p1')], { minimumSeconds: 300 }),
    quiz('q1', { poolSize: 3, shuffleOptions: true }),
  ],
});
const q1 = quizLesson(course, 'q1');
const reasons = (state: ReturnType<typeof reduceProgress>) =>
  state.rejected.map((r) => [r.eventId, r.reason]);

describe('anti-tamper', () => {
  it('counts each time_active event as 1 to 60 seconds, whatever it claims', () => {
    const l = learner();
    l.add({ type: 'time_active', lessonId: 'l1', seconds: 1e12 }, 3_600);
    l.add({ type: 'time_active', lessonId: 'l1', seconds: 3_600 }, 3_600);
    l.add({ type: 'time_active', lessonId: 'l1', seconds: 0.2 }, 30);
    l.add({ type: 'time_active', lessonId: 'l1', seconds: 12.6 }, 30);
    const state = reduceProgress(course, l.events);
    expect(MAX_ACTIVE_SECONDS_PER_EVENT).toBe(60);
    expect(state.activeSeconds).toBe(60 + 60 + 1 + 13);
    expect(state.lessons[0]?.activeSeconds).toBe(134);
  });

  it('never counts more active time than the span of the events plus 60 seconds', () => {
    const burst = learner();
    for (let i = 0; i < 100; i += 1) {
      burst.add({ type: 'time_active', lessonId: 'l1', seconds: 60 }, 0);
    }
    expect(reduceProgress(course, burst.events).activeSeconds).toBe(60);

    const fast = learner();
    for (let i = 0; i < 30; i += 1) {
      fast.add({ type: 'time_active', lessonId: 'l1', seconds: 60 }, 10);
    }
    // 30 events 10 s apart: 290 s from the first to the last, plus 60.
    expect(reduceProgress(course, fast.events).activeSeconds).toBe(350);
  });

  it("can't skip a lesson's minimum time with inflated heartbeats", () => {
    const l = learner();
    l.open('l1');
    for (let i = 0; i < 10; i += 1) l.add({ type: 'time_active', lessonId: 'l1', seconds: 600 }, 1);
    l.complete('l1');
    const state = reduceProgress(course, l.events);
    expect(state.lessons[0]?.activeSeconds).toBe(70);
    expect(state.rejected.map((r) => [r.reason, r.secondsLeft])).toEqual([['minimum_time', 230]]);
  });

  it('drops duplicate events, even when the copy has another time', () => {
    const l = learner();
    l.open('l1');
    l.spend('l1', 120);
    const state = reduceProgress(course, l.events);
    expect(reduceProgress(course, [...l.events, ...l.events])).toEqual(state);
    const replayed = l.events.map((event) => ({ ...event, at: '2026-10-28T09:00:00.000Z' }));
    expect(reduceProgress(course, [...l.events, ...replayed])).toEqual(state);
    expect(state.activeSeconds).toBe(120);
  });

  it("doesn't let a reordered or backdated stream change the result", () => {
    const l = learner();
    l.open('l1');
    l.spend('l1', 300);
    l.complete('l1');
    l.take(q1, 'a1', 3);
    const state = reduceProgress(course, l.events);
    expect(state.status).toBe('passed');
    expect(reduceProgress(course, [...l.events].reverse())).toEqual(state);
    // The completion moved before the time was spent: rejected, whatever order it is sent in.
    const early = l.events.map((event) =>
      event.type === 'lesson_completed' ? { ...event, at: '2026-10-27T09:00:02.000Z' } : event,
    );
    const backdated = reduceProgress(course, [...early].reverse());
    expect(backdated.status).toBe('in_progress');
    expect(backdated.rejected.map((r) => r.reason)).toEqual(['minimum_time']);
  });

  it('scores answers again and refuses scores sent by the browser', () => {
    const l = learner();
    const plan = l.start(q1, 'a1');
    const wrong = Object.fromEntries(
      plan.questionIds.map((id) => [id, { type: 'single_choice', optionId: 'wrong' }]),
    );
    const forged = {
      id: 'forged',
      at: '2026-10-27T09:00:05.000Z',
      type: 'quiz_attempt_submitted',
      lessonId: 'q1',
      attemptId: 'a1',
      responses: wrong,
      percent: 100,
      passed: true,
    };
    expect(reasons(reduceProgress(course, [...l.events, forged]))).toEqual([
      ['forged', 'invalid_event'],
    ]);
    l.submit('q1', 'a1', Object.fromEntries(plan.questionIds.map((id) => [id, 'wrong'])));
    const scored = reduceProgress(course, l.events);
    expect(scored.quizzes[0]).toMatchObject({ attemptsUsed: 1, bestPercent: 0, passed: false });
  });

  it("only scores the attempt's own questions", () => {
    const l = learner();
    const plan = l.start(q1, 'a1');
    expect(plan.questionIds).toHaveLength(3);
    const outside = q1.questions.filter((question) => !plan.questionIds.includes(question.id));
    l.submit('q1', 'a1', Object.fromEntries(outside.map((question) => [question.id, 'right'])));
    const state = reduceProgress(course, l.events);
    expect(state.quizzes[0]?.attempts[0]?.result).toMatchObject({ earned: 0, max: 3, percent: 0 });
    expect(state.quizzes[0]?.attempts[0]?.responses).toEqual({});
  });

  it('refuses forged attempt plans and reused attempt ids', () => {
    const l = learner();
    const plan = l.take(q1, 'a1', 0);
    const other = q1.questions.find((question) => !plan.questionIds.includes(question.id))?.id;
    const [firstId = 'x'] = plan.questionIds;
    const order = plan.optionOrder[firstId] ?? [];
    const forged = [
      { ...plan, attemptId: 'a2', questionIds: [other ?? 'x', ...plan.questionIds.slice(1)] },
      {
        ...plan,
        attemptId: 'a3',
        optionOrder: { ...plan.optionOrder, [firstId]: [...order].reverse() },
      },
      { ...plan, attemptId: 'a4', seed: plan.seed + 1 },
      plan,
    ];
    for (const forgedPlan of forged) {
      l.add({ type: 'quiz_attempt_started', lessonId: 'q1', plan: forgedPlan });
    }
    const state = reduceProgress(course, l.events);
    expect(reasons(state)).toEqual([
      ['ev-0003', 'invalid_plan'],
      ['ev-0004', 'invalid_plan'],
      ['ev-0005', 'invalid_plan'],
      ['ev-0006', 'invalid_plan'],
    ]);
    expect(state.quizzes[0]).toMatchObject({ attemptsUsed: 1, openAttempt: null });
  });

  it('refuses ids that would touch object prototypes', () => {
    const l = learner();
    l.start(q1, 'a1');
    const events = [
      ...l.events,
      JSON.parse(
        '{"id":"__proto__","at":"2026-10-27T09:00:05Z","type":"lesson_opened","lessonId":"l1"}',
      ),
      JSON.parse(
        '{"id":"e2","at":"2026-10-27T09:00:05Z","type":"lesson_opened","lessonId":"constructor"}',
      ),
      JSON.parse(
        '{"id":"e3","at":"2026-10-27T09:00:05Z","type":"quiz_attempt_submitted","lessonId":"q1",' +
          '"attemptId":"a1","responses":{"__proto__":{"type":"true_false","value":true}}}',
      ),
    ];
    const state = reduceProgress(course, events);
    expect(reasons(state)).toEqual([
      ['__proto__', 'invalid_event'],
      ['e2', 'invalid_event'],
    ]);
    expect(state.quizzes[0]?.attempts[0]?.responses).toEqual({});
    expect(({} as Record<string, unknown>).type).toBeUndefined();
  });
});
