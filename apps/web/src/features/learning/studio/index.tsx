import { useParams } from 'react-router';
import { StudioRoot } from './context';
import { CourseEditor } from './course-editor/CourseEditor';
import { CourseList } from './courses/CourseList';

/** `/learning/studio`: the courses people build. */
export function StudioScreen() {
  return (
    <StudioRoot>
      <CourseList />
    </StudioRoot>
  );
}

function EditorRoute() {
  const { courseId = '' } = useParams();
  return <CourseEditor key={courseId} courseId={courseId} />;
}

/** `/learning/studio/courses/:courseId`: the course editor. */
export function CourseEditorScreen() {
  return (
    <StudioRoot>
      <EditorRoute />
    </StudioRoot>
  );
}

// The preview is still the base PR's stub; a later Studio PR replaces it.

/** `/learning/studio/courses/:courseId/preview`: a draft as learners will see it. */
export function CoursePreviewScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Preview course</title>
      <h1 className="text-title text-fg">Preview course</h1>
    </main>
  );
}
