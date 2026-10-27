import type { Block, ContentLesson, Course, Id } from '../format/index';
import type { LearnerCourseState, ScenarioProgress } from './types';

type CompletedBlocks = readonly Id[] | ReadonlySet<Id>;

/** Blocks a complete_above continue waits for (the ones since the previous continue block). */
const GATED_TYPES: ReadonlySet<Block['type']> = new Set([
  'knowledge_check',
  'scenario',
  'process',
  'flashcards',
  'sorting',
]);

const asSet = (ids: CompletedBlocks): ReadonlySet<Id> => (ids instanceof Set ? ids : new Set(ids));

/** Index of the first continue block not passed yet; -1 when every continue block is passed. */
export function firstClosedContinue(
  lesson: ContentLesson,
  completedBlockIds: CompletedBlocks,
): number {
  const done = asSet(completedBlockIds);
  return lesson.blocks.findIndex((block) => block.type === 'continue' && !done.has(block.id));
}

/** The blocks a learner can see: up to and including the first continue block not passed. */
export function visibleBlocks(lesson: ContentLesson, completedBlockIds: CompletedBlocks): Block[] {
  const gate = firstClosedContinue(lesson, completedBlockIds);
  return gate === -1 ? [...lesson.blocks] : lesson.blocks.slice(0, gate + 1);
}

/** Unfinished blocks a complete_above continue block at `index` waits for. */
export function missingBeforeContinue(
  lesson: ContentLesson,
  index: number,
  done: ReadonlySet<Id>,
): Id[] {
  let start = index;
  while (start > 0 && lesson.blocks[start - 1]?.type !== 'continue') start -= 1;
  return lesson.blocks
    .slice(start, index)
    .filter((block) => GATED_TYPES.has(block.type) && !done.has(block.id))
    .map((block) => block.id);
}

/** Why a content lesson can't be completed yet, with the seconds or blocks still missing. */
export type LessonBlocker = {
  reason: 'locked' | 'minimum_time' | 'continue_blocks';
  secondsLeft?: number;
  blockIds?: Id[];
};

/** What stops a content lesson from being completed, checked in this order; null when nothing. */
export function lessonBlocker(
  lesson: ContentLesson,
  locked: boolean,
  activeSeconds: number,
  completedBlockIds: CompletedBlocks,
): LessonBlocker | null {
  if (locked) return { reason: 'locked' };
  const minimum = lesson.minimumSeconds ?? 0;
  if (activeSeconds < minimum)
    return { reason: 'minimum_time', secondsLeft: minimum - activeSeconds };
  const done = asSet(completedBlockIds);
  const closed = lesson.blocks.filter((block) => block.type === 'continue' && !done.has(block.id));
  return closed.length > 0
    ? { reason: 'continue_blocks', blockIds: closed.map((b) => b.id) }
    : null;
}

/** canCompleteLesson's answer: ok, or the first blocker (or why the lesson can't be completed). */
export type CanCompleteLesson =
  | { ok: true }
  | ({ ok: false } & (LessonBlocker | { reason: 'unknown_lesson' | 'wrong_lesson_kind' }));

/** Whether a content lesson can be completed now (quiz lessons complete through their attempts). */
export function canCompleteLesson(
  course: Course,
  state: LearnerCourseState,
  lessonId: Id,
): CanCompleteLesson {
  const lesson = course.lessons.find((candidate) => candidate.id === lessonId);
  if (!lesson) return { ok: false, reason: 'unknown_lesson' };
  if (lesson.kind !== 'content') return { ok: false, reason: 'wrong_lesson_kind' };
  const progress = state.lessons.find((candidate) => candidate.lessonId === lessonId);
  const blocker = lessonBlocker(
    lesson,
    progress?.status === 'locked',
    progress?.activeSeconds ?? 0,
    progress?.completedBlockIds ?? [],
  );
  return blocker ? { ok: false, ...blocker } : { ok: true };
}

/**
 * Where "Next" goes from a lesson: where the latest finished scenario in it jumped, else the next
 * lesson in order. If that one is locked, the first open lesson not completed yet; null at the end.
 * Button blocks aren't followed here: the player navigates them with go(link) and records no event.
 */
export function nextLesson(course: Course, state: LearnerCourseState, fromLessonId: Id): Id | null {
  const from = course.lessons.findIndex((lesson) => lesson.id === fromLessonId);
  if (from === -1) return null;
  const status = new Map(state.lessons.map((lesson) => [lesson.lessonId, lesson.status]));
  let jump: ScenarioProgress | null = null;
  for (const run of state.scenarios) {
    const target = run.lessonJump;
    if (run.lessonId !== fromLessonId || target === null || target === fromLessonId) continue;
    if (status.has(target) && (jump === null || run.lastFinishedAt >= jump.lastFinishedAt))
      jump = run;
  }
  const candidate = jump?.lessonJump ?? course.lessons[from + 1]?.id;
  if (candidate === undefined) return null;
  if (status.get(candidate) !== 'locked') return candidate;
  const open = course.lessons.find((lesson) => {
    const current = status.get(lesson.id);
    return lesson.id !== fromLessonId && current !== 'locked' && current !== 'completed';
  });
  return open?.id ?? null;
}
