import type {
  Block,
  BlockType,
  ContentLesson,
  Course,
  LearnerCourseState,
  Link,
  NewProgressEvent,
} from '@carehub/learning';
import type { JSX } from 'react';
import { interactiveViews } from './interactive';
import { mediaViews } from './media';
import { questionViews } from './questions';
import { textViews } from './text';

/** Where a block shows: a learner's own run, Studio's preview, or a reviewer reading a draft. */
export type BlockViewMode = 'learn' | 'preview' | 'review';

/** What every block view gets (docs/learning/PLAN.md, "Shared web contracts"). */
export type BlockViewProps<B extends Block = Block> = {
  block: B;
  lesson: ContentLesson;
  course: Course;
  mode: BlockViewMode;
  /** The learner's progress in this course (an empty one in preview and review). */
  state: LearnerCourseState;
  /** Records something the learner did; the player adds its id and time and sends it. */
  emit(event: NewProgressEvent): void;
  /** Opens a lesson, a block or a Care Hub page inside the app. */
  go(link: Link): void;
};

/** The view of one block type. */
export type BlockViewOf<T extends BlockType> = (
  props: BlockViewProps<Extract<Block, { type: T }>>,
) => JSX.Element;

/** Views by block type. Each family file exports one: textViews, mediaViews, interactiveViews and
 * questionViews. */
export type BlockViews = { [T in BlockType]?: BlockViewOf<T> };

/** Every block view, by type. */
export const blockViews: BlockViews = {
  ...textViews,
  ...mediaViews,
  ...interactiveViews,
  ...questionViews,
};

/** One block, shown by its type's view, or a plain note when its type has no view yet. */
export function BlockView(props: BlockViewProps) {
  const View = blockViews[props.block.type] as ((props: BlockViewProps) => JSX.Element) | undefined;
  if (!View) {
    return (
      <p className="rounded border border-border bg-fill px-4 py-3 text-small text-muted">
        This block can't be shown yet.
      </p>
    );
  }
  return <View {...props} />;
}
