import { IdSchema, courseOutline, type Id } from '@carehub/learning';
import { Navigate, useLocation, useParams } from 'react-router';
import { useLearnerCourse } from '../player/data';
import { CourseNotFound, LoadFailed, ScreenLoading } from '../player/ScreenMessage';
import { CourseStart } from './CourseStart';
import { resumeHref, wantsResume } from './start';

/** `/learning/courses/:courseId`: a course's start page. */
export function CourseStartScreen() {
  const params = useParams();
  const courseId = IdSchema.safeParse(params.courseId);
  if (!courseId.success) return <CourseNotFound />;
  return <LiveCourseStart courseId={courseId.data} />;
}

/**
 * The start page for a learner: the course (the version of their latest run) and progress. Opened
 * from a course in progress on My learning, it goes straight on to where they stopped.
 */
function LiveCourseStart({ courseId }: { courseId: Id }) {
  const { course, state, pending, emit, error, retry } = useLearnerCourse(courseId);
  const resume = wantsResume(useLocation().state);
  if (!course || !state) {
    if (!error) return <ScreenLoading label="Loading course" />;
    return <LoadFailed error={error} what="course" retry={retry} />;
  }
  const href = resume ? resumeHref(course, state, courseOutline(course, state)) : null;
  if (href) return <Navigate to={href} replace />;
  return <CourseStart course={course} state={state} emit={emit} waiting={pending.length} />;
}
