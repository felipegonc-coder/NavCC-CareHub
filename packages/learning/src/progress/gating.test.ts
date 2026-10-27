import { describe, expect, it } from 'vitest';
import type { ContentLesson } from '../format/index';
import { missingBeforeContinue } from './gating';
import { canCompleteLesson, nextLesson, ProgressEventSchema, visibleBlocks } from './index';
import type { LearnerCourseState, LessonProgress, ScenarioProgress } from './index';
import { blocks, content, makeCourse, quiz } from './test-helpers';

const course = makeCourse({
  lessonOrder: 'sequential',
  lessons: [
    content(
      'l1',
      [
        blocks.check('kc1'),
        blocks.process('pr1'),
        blocks.continue('c1', 'complete_above'),
        blocks.paragraph('p1'),
        blocks.scenario('sc1', 'l4'),
        blocks.continue('c2'),
        blocks.paragraph('p2'),
      ],
      { minimumSeconds: 60 },
    ),
    content('l2', [blocks.paragraph('p3')]),
    quiz('q3'),
    content('l4', [blocks.paragraph('p4')]),
  ],
});
const l1 = course.lessons[0] as ContentLesson;
const ids = (list: { id: string }[]) => list.map((item) => item.id);

/** A hand-made state: every lesson not started unless given. */
function stateWith(
  lessons: Record<string, Partial<LessonProgress>>,
  scenarios: Partial<ScenarioProgress>[] = [],
): LearnerCourseState {
  return {
    courseId: course.id,
    status: 'in_progress',
    blockedBy: null,
    startedAt: null,
    completedAt: null,
    lastActivityAt: null,
    activeSeconds: 0,
    percentComplete: 0,
    lessons: course.lessons.map((lesson) => ({
      lessonId: lesson.id,
      status: 'not_started',
      activeSeconds: 0,
      completedBlockIds: [],
      minimumMet: true,
      lastOpenedAt: null,
      completedAt: null,
      ...lessons[lesson.id],
    })),
    quizzes: [],
    knowledgeChecks: [],
    scenarios: scenarios.map((run) => ({
      lessonId: 'l1',
      blockId: 'sc1',
      runs: 1,
      bestScore: 1,
      choiceIds: ['jump'],
      score: 1,
      maxScore: 5,
      passed: false,
      outcome: null,
      lessonJump: null,
      lastFinishedAt: '2026-10-27T09:00:00.000Z',
      ...run,
    })),
    acknowledgedAt: null,
    score: null,
    resume: null,
    rejected: [],
  };
}

describe('visibleBlocks', () => {
  it('shows blocks up to and including the first continue block not passed', () => {
    expect(ids(visibleBlocks(l1, []))).toEqual(['kc1', 'pr1', 'c1']);
    expect(ids(visibleBlocks(l1, new Set(['kc1', 'pr1', 'c1'])))).toEqual([
      'kc1',
      'pr1',
      'c1',
      'p1',
      'sc1',
      'c2',
    ]);
    expect(ids(visibleBlocks(l1, ['c1', 'c2']))).toEqual(ids(l1.blocks));
  });

  it('lists what a complete_above continue block still waits for', () => {
    expect(missingBeforeContinue(l1, 2, new Set())).toEqual(['kc1', 'pr1']);
    expect(missingBeforeContinue(l1, 2, new Set(['kc1']))).toEqual(['pr1']);
    // Only the blocks since the previous continue block count.
    expect(missingBeforeContinue(l1, 5, new Set())).toEqual(['sc1']);
  });
});

describe('canCompleteLesson', () => {
  it('checks the lock, then the minimum time, then the continue blocks', () => {
    expect(canCompleteLesson(course, stateWith({ l2: { status: 'locked' } }), 'l2')).toEqual({
      ok: false,
      reason: 'locked',
    });
    expect(canCompleteLesson(course, stateWith({ l1: { activeSeconds: 20 } }), 'l1')).toEqual({
      ok: false,
      reason: 'minimum_time',
      secondsLeft: 40,
    });
    const timed = stateWith({ l1: { activeSeconds: 60, completedBlockIds: ['kc1', 'pr1', 'c1'] } });
    expect(canCompleteLesson(course, timed, 'l1')).toEqual({
      ok: false,
      reason: 'continue_blocks',
      blockIds: ['c2'],
    });
    const ready = stateWith({ l1: { activeSeconds: 61, completedBlockIds: ['c1', 'c2'] } });
    expect(canCompleteLesson(course, ready, 'l1')).toEqual({ ok: true });
    expect(canCompleteLesson(course, stateWith({}), 'l2')).toEqual({ ok: true });
  });

  it('says why when the lesson is unknown or is a quiz', () => {
    expect(canCompleteLesson(course, stateWith({}), 'nope')).toEqual({
      ok: false,
      reason: 'unknown_lesson',
    });
    expect(canCompleteLesson(course, stateWith({}), 'q3')).toEqual({
      ok: false,
      reason: 'wrong_lesson_kind',
    });
  });
});

describe('nextLesson', () => {
  const locked = { status: 'locked' } as const;

  it('goes to the next lesson in order and stops at the end', () => {
    const state = stateWith({ l1: { status: 'completed' } });
    expect(nextLesson(course, state, 'l1')).toBe('l2');
    expect(nextLesson(course, state, 'q3')).toBe('l4');
    expect(nextLesson(course, state, 'l4')).toBeNull();
    expect(nextLesson(course, state, 'nope')).toBeNull();
  });

  it('follows the latest scenario lesson jump from the lesson', () => {
    const state = stateWith({ l2: locked, q3: locked }, [
      { lessonJump: 'q3', lastFinishedAt: '2026-10-27T09:00:00.000Z' },
      { lessonJump: 'l4', lastFinishedAt: '2026-10-27T09:05:00.000Z' },
      { lessonJump: 'gone', lastFinishedAt: '2026-10-27T09:09:00.000Z' },
    ]);
    expect(nextLesson(course, state, 'l1')).toBe('l4');
    // A jump from another lesson doesn't count.
    expect(nextLesson(course, stateWith({}, [{ lessonId: 'l2', lessonJump: 'l4' }]), 'l1')).toBe(
      'l2',
    );
  });

  it('falls back to the first open lesson not completed when the next one is locked', () => {
    const state = stateWith({ l1: { status: 'in_progress' }, q3: locked, l4: locked });
    expect(nextLesson(course, state, 'l2')).toBe('l1');
    const stuck = stateWith({ l1: { status: 'in_progress' }, l2: locked, q3: locked, l4: locked });
    expect(nextLesson(course, stuck, 'l1')).toBeNull();
  });
});

describe('ProgressEventSchema', () => {
  const at = '2026-10-27T09:00:00Z';
  const plan = { attemptId: 'a1', seed: 7, questionIds: ['q1'], optionOrder: { q1: ['x', 'y'] } };

  it('reads every event type', () => {
    const events = [
      { type: 'lesson_opened', lessonId: 'l1' },
      { type: 'time_active', lessonId: 'l1', seconds: 12.5 },
      { type: 'block_completed', lessonId: 'l1', blockId: 'c1' },
      {
        type: 'knowledge_check_answered',
        lessonId: 'l1',
        blockId: 'kc1',
        response: { type: 'single_choice', optionId: 'right' },
      },
      { type: 'scenario_finished', lessonId: 'l1', blockId: 'sc1', choiceIds: ['good'] },
      { type: 'lesson_completed', lessonId: 'l1' },
      { type: 'quiz_attempt_started', lessonId: 'q3', plan },
      { type: 'quiz_attempt_submitted', lessonId: 'q3', attemptId: 'a1', responses: {} },
      { type: 'acknowledged', statement: 'I have read it.' },
    ];
    for (const [index, event] of events.entries()) {
      expect(ProgressEventSchema.safeParse({ id: `e${index}`, at, ...event }).success).toBe(true);
    }
  });

  it('refuses anything else', () => {
    const bad = [
      { id: 'e1', at, type: 'lesson_skipped', lessonId: 'l1' },
      { id: 'e2', at, type: 'lesson_opened', lessonId: 'l1', score: 100 },
      { id: 'has space', at, type: 'lesson_opened', lessonId: 'l1' },
      { id: 'e3', at, type: 'lesson_opened', lessonId: 'constructor' },
      { id: 'e4', at: '2026-10-27 09:00', type: 'lesson_opened', lessonId: 'l1' },
      { id: 'e5', at, type: 'time_active', lessonId: 'l1', seconds: 0 },
      { id: 'e6', at, type: 'time_active', lessonId: 'l1', seconds: Number.POSITIVE_INFINITY },
      { id: 'e7', at, type: 'quiz_attempt_started', lessonId: 'q3', plan: { ...plan, seed: 1.5 } },
      {
        id: 'e8',
        at,
        type: 'quiz_attempt_started',
        lessonId: 'q3',
        plan: { ...plan, passed: true },
      },
      {
        id: 'e9',
        at,
        type: 'scenario_finished',
        lessonId: 'l1',
        blockId: 'sc1',
        choiceIds: Array.from({ length: 1_001 }, () => 'good'),
      },
      { id: 'e10', at, type: 'acknowledged', statement: 'x'.repeat(501) },
    ];
    for (const event of bad) expect(ProgressEventSchema.safeParse(event).success).toBe(false);
  });
});
