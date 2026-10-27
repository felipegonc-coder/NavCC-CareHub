import { IdSchema, type Id } from '@carehub/learning';
import { useParams } from 'react-router';
import { useLearnerCourse } from '../player/data';
import { CourseNotFound, LoadFailed, ScreenLoading } from '../player/ScreenMessage';
import { CourseStart } from './CourseStart';

/** `/learning/courses/:courseId`: a course's start page. */
export function CourseStartScreen() {
  const params = useParams();
  const courseId = IdSchema.safeParse(params.courseId);
  if (!courseId.success) return <CourseNotFound />;
  return <LiveCourseStart courseId={courseId.data} />;
}

/** The start page for a learner: the course (the version of their latest run) and progress. */
function LiveCourseStart({ courseId }: { courseId: Id }) {
  const { course, state, error, retry } = useLearnerCourse(courseId);
  if (!course || !state) {
    if (!error) return <ScreenLoading label="Loading course" />;
    return <LoadFailed error={error} what="course" retry={retry} />;
  }
  return <CourseStart course={course} state={state} />;
}
