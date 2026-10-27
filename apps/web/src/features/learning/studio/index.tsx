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

/** `/learning/studio/courses/:courseId/preview`: a draft as learners will see it (coming with publishing). */
export function CoursePreviewScreen() {
  return (
    <StudioRoot>
      <main className="mx-auto max-w-page px-6 py-16">
        <title>Care Hub · Preview course</title>
        <h1 className="text-title text-fg">Preview course</h1>
      </main>
    </StudioRoot>
  );
}
