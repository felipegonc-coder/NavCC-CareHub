import {
  continueBlockLabel,
  playerLabels,
  type Block,
  type ContentLesson,
  type ContinueBlock,
  type Id,
} from '@carehub/learning';
import { Button } from '@carehub/ui';
import { useId } from 'react';
import type { BlockViewProps } from '../registry';

/** The blocks a "complete_above" continue block waits for (course-format.md). */
const ACTIVITIES: ReadonlySet<Block['type']> = new Set([
  'knowledge_check',
  'scenario',
  'process',
  'flashcards',
  'sorting',
]);

/** The activities between the previous continue block and this one that aren't finished yet. */
export function unfinishedAbove(
  lesson: ContentLesson,
  blockId: Id,
  done: ReadonlySet<Id>,
): Block[] {
  const waiting: Block[] = [];
  for (
    let index = lesson.blocks.findIndex((block) => block.id === blockId) - 1;
    index >= 0;
    index -= 1
  ) {
    const block = lesson.blocks[index];
    if (!block || block.type === 'continue') break;
    if (ACTIVITIES.has(block.type) && !done.has(block.id)) waiting.unshift(block);
  }
  return waiting;
}

/**
 * Everything after a continue block stays hidden until the learner passes it. "complete_above"
 * also waits for the activities above it. Once passed it disappears.
 */
export function ContinueView({
  block,
  lesson,
  course,
  state,
  emit,
}: BlockViewProps<ContinueBlock>) {
  const hintId = useId();
  const progress = state.lessons.find((entry) => entry.lessonId === lesson.id);
  const done = new Set(progress?.completedBlockIds);
  if (done.has(block.id)) return <></>;
  const waiting =
    block.requires === 'complete_above' ? unfinishedAbove(lesson, block.id, done) : [];
  return (
    <div className="flex flex-col items-center gap-2 py-4">
      <Button
        disabled={waiting.length > 0}
        aria-describedby={waiting.length > 0 ? hintId : undefined}
        onClick={() => emit({ type: 'block_completed', lessonId: lesson.id, blockId: block.id })}
        className="max-md:h-11"
      >
        {continueBlockLabel(block, playerLabels(course))}
      </Button>
      {waiting.length > 0 && (
        <p id={hintId} className="text-small text-muted">
          {waiting.length === 1
            ? 'Finish the activity above to continue.'
            : `Finish the ${waiting.length} activities above to continue.`}
        </p>
      )}
    </div>
  );
}
