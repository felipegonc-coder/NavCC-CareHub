import type { Block, ContentLesson, Course, Id, Link } from '@carehub/learning';

/**
 * The parts of B5's `BlockViewProps` (docs/learning/PLAN.md, "Shared web contracts") that the media and
 * interactive views use, so each view fits `blockViews` as it is.
 */
export type ViewProps<B extends Block> = {
  block: B;
  lesson: Pick<ContentLesson, 'id'>;
  course: Pick<Course, 'id' | 'lessons'>;
  mode: 'learn' | 'preview' | 'review';
  /** The learner's progress: the interactive views show blocks finished before as done. */
  state: { lessons: readonly { lessonId: Id; completedBlockIds: readonly Id[] }[] };
  emit(event: { type: 'block_completed'; lessonId: Id; blockId: Id }): void;
  go(link: Link): void;
};

/** Whether the learner finished this block before (process, flashcards, sorting). */
export function finishedBefore({ block, lesson, state }: ViewProps<Block>): boolean {
  const progress = state.lessons.find((item) => item.lessonId === lesson.id);
  return progress?.completedBlockIds.includes(block.id) ?? false;
}
