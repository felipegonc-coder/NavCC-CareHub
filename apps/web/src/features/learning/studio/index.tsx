import { useParams } from 'react-router';
import { StudioRoot } from './context';
import { CourseEditor } from './course-editor/CourseEditor';
import { CourseList } from './courses/CourseList';
import { CoursePreview } from './preview/CoursePreview';

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

function PreviewRoute() {
  const { courseId = '' } = useParams();
  return <CoursePreview key={courseId} courseId={courseId} />;
}

/** `/learning/studio/courses/:courseId/preview`: the saved draft as learners will see it. */
export function CoursePreviewScreen() {
  return (
    <StudioRoot>
      <PreviewRoute />
    </StudioRoot>
  );
}
