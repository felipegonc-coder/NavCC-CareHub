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
import { useMediaUrl } from '../media';
import { OfflineNote } from '../player/OfflineNote';
import { Outline } from '../player/Outline';
import { outlinePercent, ProgressBar } from '../player/ProgressBar';
import { useFollowLink } from '../player/useFollowLink';
import { SignOffSection } from './SignOff';
import { almostDoneLine, courseFacts, hasStarted, signOff, startAction, statusLine } from './start';

type CourseStartProps = {
  course: PlayerCourse;
  state: LearnerCourseState;
  emit(event: NewProgressEvent): void;
  /** How many of the learner's steps wait to be sent; a note says so while they can't be. */
  waiting?: number;
};

type Cover = NonNullable<PlayerCourse['cover']>;
type CoverLayout = NonNullable<PlayerCourse['coverLayout']>;

/**
 * The cover's size in each layout (course-format.md): a banner above the title, half of the
 * heading on wider screens (above it on phones), or a large picture across the top of the page.
 */
const COVER_CLASSES: Record<CoverLayout, string> = {
  banner: 'h-40 rounded md:h-56',
  split: 'aspect-video rounded',
  full: 'h-56 md:h-80',
};

/** The course's cover picture, or nothing when its address can't be shown. */
function CourseCover({ cover, layout }: { cover: Cover; layout: CoverLayout }) {
  const src = useMediaUrl(cover.media);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={cover.decorative ? '' : cover.alt}
      className={cn('w-full bg-fill object-cover', COVER_CLASSES[layout])}
    />
  );
}

/**
 * A course's start page: its cover, what the course is, how far the learner is, the button to
 * start, carry on or look back through it, the sign-off when the course asks for one, and its
 * lessons.
 */
export function CourseStart({ course, state, emit, waiting = 0 }: CourseStartProps) {
  const go = useFollowLink(course);
  const progressId = useId();
  const lessonsId = useId();
  const outline = courseOutline(course, state);
  const percent = outlinePercent(outline);
  const action = startAction(course, state, outline);
  const sign = signOff(course, state);
  const almostDone = almostDoneLine(course, state, outline, sign);
  const layout = course.coverLayout ?? 'banner';
  const cover = course.cover && <CourseCover cover={course.cover} layout={layout} />;
  return (
    <main className="flex w-full flex-col text-fg">
      <title>{`Care Hub · ${course.title}`}</title>
      <OfflineNote waiting={waiting} className="border-b border-border md:px-6" />
      {layout === 'full' && cover}
      <div
        className={cn(
          'mx-auto flex w-full max-w-page flex-col gap-8 px-4 py-6',
          'md:px-6 md:py-10',
        )}
      >
        <Link
          to="/learning"
          className={cn(
            'flex min-h-11 items-center gap-1 self-start text-small text-muted',
            'hover:text-fg',
          )}
        >
          <ArrowLeft aria-hidden className="size-4" />
          My learning
        </Link>
        <div
          data-cover={course.cover ? layout : undefined}
          className={cn(
            'flex flex-col gap-6',
            layout === 'split' && cover && 'md:grid md:grid-cols-2 md:items-center',
          )}
        >
          {layout !== 'full' && cover}
          <div className="flex min-w-0 flex-col gap-3">
            <h1 className="break-words text-title">{course.title}</h1>
            {course.summary && <p className="text-body text-muted">{course.summary}</p>}
            <p className="text-small text-muted">
              {courseFacts(course.lessons.length, course.estimatedMinutes)}
            </p>
            {course.topics && <TopicList topics={course.topics} />}
          </div>
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
      </div>
    </main>
  );
}
