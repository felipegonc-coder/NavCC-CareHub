import type { Course, Id } from '@carehub/learning';
import type { CourseEditorSelection } from '../state/course-editor';

/** How a change is recorded: `group` merges quick typing into one undo step; `select` moves the selection. */
export type EditOptions = { group?: string; select?: CourseEditorSelection };

/** What the editor's panels can do to the draft. */
export type EditorActions = {
  /** Applies a pure edit (from the authoring module) as one undo step. */
  edit(change: (course: Course) => Course, options?: EditOptions): void;
  /** Applies a deleting edit and offers Undo with `message`. */
  remove(message: string, change: (course: Course) => Course): void;
  /** Shows a lesson on the canvas. */
  select(lessonId: Id): void;
};
