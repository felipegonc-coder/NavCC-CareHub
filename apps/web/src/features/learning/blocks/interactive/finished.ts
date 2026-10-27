import type { Block } from '@carehub/learning';
import type { BlockViewProps } from '../registry';

/** Whether the learner finished this block before (process, flashcards and sorting). */
export function finishedBefore({
  block,
  lesson,
  state,
}: Pick<BlockViewProps<Block>, 'block' | 'lesson' | 'state'>): boolean {
  const progress = state.lessons.find((item) => item.lessonId === lesson.id);
  return progress?.completedBlockIds.includes(block.id) ?? false;
}
