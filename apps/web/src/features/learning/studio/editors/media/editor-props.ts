import type { Block, Course, Id } from '@carehub/learning';

/** B8's `BlockEditorProps` (docs/learning/PLAN.md, "Shared web contracts"), so each editor fits the registry. */
export type EditorProps<B extends Block> = {
  block: B;
  onChange(next: B): void;
  course: Course;
  lessonId: Id;
};
