import { StudioRoot } from './context';
import { CourseList } from './courses/CourseList';

/** `/learning/studio`: the courses people build. */
export function StudioScreen() {
  return (
    <StudioRoot>
      <CourseList />
    </StudioRoot>
  );
}

// The editor and the preview are still the base PR's stubs; the next Studio PRs replace them.

/** `/learning/studio/courses/:courseId`: the course editor. */
export function CourseEditorScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Edit course</title>
      <h1 className="text-title text-fg">Edit course</h1>
    </main>
  );
}

/** `/learning/studio/courses/:courseId/preview`: a draft as learners will see it. */
export function CoursePreviewScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Preview course</title>
      <h1 className="text-title text-fg">Preview course</h1>
    </main>
  );
}
