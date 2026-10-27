import type { Course, Id } from '@carehub/learning';
import type { JSX } from 'react';
import type { EditorActions } from './course-editor/types';

/** What Learning help gets in the lesson editor: the draft, the lesson, `edit` (one undo step) and `flush`. */
export type LessonHelpProps = Pick<EditorActions, 'edit'> & {
  course: Course;
  lessonId: Id;
  /**
   * Saves any change still waiting; true once the draft is saved. The server reads the saved draft, never text
   * from the browser (0315), so help waits for this first.
   */
  flush(): Promise<boolean>;
};

/**
 * What Learning help gets in New course: `onDraft`, for a course it drafted once the author accepts it. Studio
 * saves it as a new course and opens it in the editor. The promise is true once it's saved, and false if it
 * couldn't be (Studio says so).
 */
export type NewCourseHelpProps = { onDraft(course: Course): Promise<boolean> };

/**
 * Places in Studio for Learning help's buttons (PLAN "Learning help", decision 0315). Learning help fills them in;
 * a place it leaves empty, as it does while the feature is off, shows nothing. The rich text toolbar gets its place
 * with the editor's toolbar.
 */
export const studioHelp: {
  lesson?: (props: LessonHelpProps) => JSX.Element | null;
  newCourse?: (props: NewCourseHelpProps) => JSX.Element | null;
} = {};
