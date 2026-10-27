import { IdSchema, courseHref, type Id } from '@carehub/learning';
import { Button, buttonClasses, Spinner } from '@carehub/ui';
import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { LearningApiError } from '../data';
import { useLearnerState, useLiveCourse, useProgressEvents } from './data';
import { withPending } from './pending';
import { Player } from './Player';

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
  const live = useLiveCourse(courseId);
  const progress = useLearnerState(courseId);
  const { pending, emit } = useProgressEvents(courseId);
  const course = live.data?.course;
  const state = useMemo(
    () => (course && progress.data ? withPending(course, progress.data, pending) : undefined),
    [course, progress.data, pending],
  );

  if (!course || !state) {
    const error = live.error ?? progress.error;
    if (!error) {
      return (
        <main aria-busy="true" className="mx-auto flex max-w-page flex-col gap-4 px-6 py-16">
          <title>Care Hub · Loading lesson</title>
          <h1 className="sr-only">Loading lesson</h1>
          <Spinner label="Loading lesson" />
        </main>
      );
    }
    if (error instanceof LearningApiError && (error.status === 403 || error.status === 404)) {
      return (
        <Message
          title="Course not found"
          text="This course doesn't exist or isn't shared with you."
        >
          <Link to="/learning" className={buttonClasses({ variant: 'secondary' })}>
            Go to My learning
          </Link>
        </Message>
      );
    }
    const retry = () => {
      void live.refetch();
      void progress.refetch();
    };
    return (
      <Message
        title="This lesson didn't load"
        text={error instanceof LearningApiError ? error.message : 'Something went wrong.'}
      >
        <Button onClick={retry}>Try again</Button>
      </Message>
    );
  }
  if (!course.lessons.some((lesson) => lesson.id === lessonId)) {
    return <LessonNotFound courseId={courseId} />;
  }
  return <Player course={course} state={state} lessonId={lessonId} mode="learn" emit={emit} />;
}

function LessonNotFound({ courseId }: { courseId?: Id }) {
  return (
    <Message title="Lesson not found" text="Check the link, or open the course again.">
      <Link
        to={courseId ? courseHref(courseId) : '/learning'}
        className={buttonClasses({ variant: 'secondary' })}
      >
        {courseId ? 'Open the course' : 'Go to My learning'}
      </Link>
    </Message>
  );
}

function Message({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex max-w-page flex-col items-start gap-4 px-6 py-16">
      <title>{`Care Hub · ${title}`}</title>
      <h1 className="text-title text-fg">{title}</h1>
      <p className="text-body text-muted">{text}</p>
      {children}
    </main>
  );
}
