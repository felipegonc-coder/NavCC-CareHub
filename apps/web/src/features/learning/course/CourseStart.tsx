import {
  courseOutline,
  type LearnerCourseState,
  type NewProgressEvent,
  type PlayerCourse,
} from '@carehub/learning';
import { buttonClasses, cn } from '@carehub/ui';
import { ArrowLeft } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';
import { RichTextView } from '../blocks/text/RichTextView';
import { TopicList } from '../catalog/CourseCard';
import { Outline } from '../player/Outline';
import { outlinePercent, ProgressBar } from '../player/ProgressBar';
import { useFollowLink } from '../player/useFollowLink';
import { SignOffSection } from './SignOff';
import { almostDoneLine, courseFacts, hasStarted, signOff, startAction, statusLine } from './start';

type CourseStartProps = {
  course: PlayerCourse;
  state: LearnerCourseState;
  emit(event: NewProgressEvent): void;
};

/**
 * A course's start page: what the course is, how far the learner is, the button to start, carry on
 * or look back through it, the sign-off when the course asks for one, and its lessons.
 */
export function CourseStart({ course, state, emit }: CourseStartProps) {
  const go = useFollowLink(course);
  const progressId = useId();
  const lessonsId = useId();
  const outline = courseOutline(course, state);
  const percent = outlinePercent(outline);
  const action = startAction(course, state, outline);
  const sign = signOff(course, state);
  const almostDone = almostDoneLine(course, state, outline, sign);
  return (
    <main
      className={cn(
        'mx-auto flex w-full max-w-page flex-col gap-8 px-4 py-6 text-fg',
        'md:px-6 md:py-10',
      )}
    >
      <title>{`Care Hub · ${course.title}`}</title>
      <Link
        to="/learning"
        className="flex min-h-11 items-center gap-1 self-start text-small text-muted hover:text-fg"
      >
        <ArrowLeft aria-hidden className="size-4" />
        My learning
      </Link>
      <div className="flex flex-col gap-3">
        <h1 className="break-words text-title">{course.title}</h1>
        {course.summary && <p className="text-body text-muted">{course.summary}</p>}
        <p className="text-small text-muted">
          {courseFacts(course.lessons.length, course.estimatedMinutes)}
        </p>
        {course.topics && <TopicList topics={course.topics} />}
      </div>
      <section
        aria-labelledby={progressId}
        className="flex flex-col gap-3 rounded border border-border p-4"
      >
        <h2 id={progressId} className="sr-only">
          Your progress
        </h2>
        <p className="text-body font-medium">
          {statusLine(state, percent, hasStarted(state, outline))}
        </p>
        <ProgressBar percent={percent} label="Course progress" />
        {almostDone && <p className="text-small text-muted">{almostDone}</p>}
        {action ? (
          <Link to={action.href} className={buttonClasses({ className: 'self-start' })}>
            {action.label}
          </Link>
        ) : (
          <p className="text-small text-muted">This course has no lessons yet.</p>
        )}
      </section>
      {sign && <SignOffSection signOff={sign} emit={emit} />}
      <RichTextView value={course.description} course={course} go={go} className="text-body" />
      <section aria-labelledby={lessonsId} className="flex flex-col gap-2">
        <h2 id={lessonsId} className="text-h2">
          Lessons
        </h2>
        <Outline outline={outline} />
      </section>
    </main>
  );
}
