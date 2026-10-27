import { sampleRequiredReadCourse, type ProgressEvent } from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import { withPending } from './pending';
import { inOrder, learner } from './test-utils';

const at = '2026-10-27T09:00:00.000Z';
const event = (fields: Record<string, unknown>, id = 'e1') =>
  ({ id, at, ...fields }) as ProgressEvent;
const lesson = (state: ReturnType<typeof learner>, lessonId: string) =>
  state.lessons.find((entry) => entry.lessonId === lessonId);

describe('withPending', () => {
  const state = learner(inOrder, {
    'calls-before': { status: 'in_progress' },
    'calls-during': { status: 'locked' },
    'calls-after': { status: 'locked' },
    'calls-quiz': { status: 'locked' },
  });

  it('returns the same state when nothing is waiting', () => {
    expect(withPending(inOrder, state, [])).toBe(state);
  });

  it('adds finished blocks once and starts the lesson', () => {
    const fresh = learner(inOrder);
    const next = withPending(inOrder, fresh, [
      event({
        type: 'block_completed',
        lessonId: 'calls-before',
        blockId: 'calls-before-continue',
      }),
      event({
        type: 'block_completed',
        lessonId: 'calls-before',
        blockId: 'calls-before-continue',
      }),
      event({
        type: 'knowledge_check_answered',
        lessonId: 'calls-during',
        blockId: 'k',
        correct: false,
      }),
    ]);
    expect(lesson(next, 'calls-before')).toMatchObject({
      status: 'in_progress',
      completedBlockIds: ['calls-before-continue'],
    });
    expect(lesson(next, 'calls-during')?.completedBlockIds).toEqual(['k']);
    expect(lesson(fresh, 'calls-before')?.completedBlockIds).toEqual([]);
  });

  it('adds active time to the lesson', () => {
    const next = withPending(inOrder, state, [
      event({ type: 'time_active', lessonId: 'calls-before', seconds: 60 }),
      event({ type: 'time_active', lessonId: 'calls-before', seconds: 15 }, 'e2'),
    ]);
    expect(lesson(next, 'calls-before')?.activeSeconds).toBe(75);
  });

  it('completes a lesson and, in order, opens the next one only', () => {
    const next = withPending(inOrder, state, [
      event({ type: 'lesson_opened', lessonId: 'calls-before' }),
      event({ type: 'lesson_completed', lessonId: 'calls-before' }),
    ]);
    expect(lesson(next, 'calls-before')).toMatchObject({ status: 'completed', completedAt: at });
    expect(lesson(next, 'calls-during')?.status).toBe('not_started');
    expect(lesson(next, 'calls-after')?.status).toBe('locked');
  });

  it('leaves locked lessons alone, as the server refuses their events', () => {
    const next = withPending(inOrder, state, [
      event({ type: 'block_completed', lessonId: 'calls-after', blockId: 'calls-after-note' }),
      event({ type: 'lesson_completed', lessonId: 'calls-after' }),
    ]);
    expect(lesson(next, 'calls-after')).toEqual(lesson(state, 'calls-after'));
  });

  it('signs the sign-off once every content lesson is completed, as the server does', () => {
    const course = sampleRequiredReadCourse;
    const statement = course.settings.acknowledgement?.statement;
    const sign = event({ type: 'acknowledged', statement });
    const read = learner(course, { 'privacy-rules': { status: 'completed' } });
    expect(withPending(course, read, [sign]).acknowledgedAt).toBe(at);
    expect(withPending(course, learner(course), [sign]).acknowledgedAt).toBeNull();
    const wrong = event({ type: 'acknowledged', statement: 'Something else.' });
    expect(withPending(course, read, [wrong]).acknowledgedAt).toBeNull();
    const notAsked = learner(inOrder, { 'calls-before': { status: 'completed' } });
    expect(withPending(inOrder, notAsked, [sign]).acknowledgedAt).toBeNull();
  });
});
