import { IdSchema, courseHref, type Id } from '@carehub/learning';
import { buttonClasses } from '@carehub/ui';
import { Link, useParams } from 'react-router';
import { useLearnerCourse } from './data';
import { Player } from './Player';
import { LoadFailed, MyLearningLink, ScreenLoading, ScreenMessage } from './ScreenMessage';

/** `/learning/courses/:courseId/lessons/:lessonId`: the course player. */
export function PlayerScreen() {
  const params = useParams();
  const courseId = IdSchema.safeParse(params.courseId);
  const lessonId = IdSchema.safeParse(params.lessonId);
  if (!courseId.success || !lessonId.success) return <LessonNotFound />;
  return <LivePlayer courseId={courseId.data} lessonId={lessonId.data} />;
}

/** The player for a learner: the live course, their progress and the events they send. */
function LivePlayer({ courseId, lessonId }: { courseId: Id; lessonId: Id }) {
  const { course, state, emit, error, retry } = useLearnerCourse(courseId);
  if (!course || !state) {
    if (!error) return <ScreenLoading label="Loading lesson" />;
    return <LoadFailed error={error} what="lesson" retry={retry} />;
  }
  if (!course.lessons.some((lesson) => lesson.id === lessonId)) {
    return <LessonNotFound courseId={courseId} />;
  }
  return <Player course={course} state={state} lessonId={lessonId} mode="learn" emit={emit} />;
}

function LessonNotFound({ courseId }: { courseId?: Id }) {
  return (
    <ScreenMessage title="Lesson not found" text="Check the link, or open the course again.">
      {courseId ? (
        <Link
          to={courseHref(courseId)}
          className={buttonClasses({ variant: 'secondary', className: 'max-md:h-11' })}
        >
          Open the course
        </Link>
      ) : (
        <MyLearningLink />
      )}
    </ScreenMessage>
  );
}
