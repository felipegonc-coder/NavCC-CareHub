import { courseHref, type PathCourse, type PathPage } from '@carehub/learning';
import { buttonClasses, cn } from '@carehub/ui';
import { useId } from 'react';
import { Link } from 'react-router';
import { ProgressBar } from '../player/ProgressBar';
import { COURSE_STATUS_LABELS, minutesText, progressLine } from './data';

const FINISHED = new Set<PathCourse['status']>(['completed', 'passed']);

/**
 * A learning path: what it is, how far the learner is, the button to the next course, and the
 * courses in path order. On a sequential path, the courses after the first unfinished one are
 * locked: they show without a link.
 */
export function PathView({ page }: { page: PathPage }) {
  const { path, courses, progress } = page;
  const next = courses.find((course) => course.id === progress.nextCourseId);
  const listId = useId();
  return (
    <main
      className={cn(
        'mx-auto flex w-full max-w-page flex-col gap-6 px-4 py-6 text-fg',
        'md:px-6 md:py-10',
      )}
    >
      <title>{`Care Hub · ${path.title}`}</title>
      <div className="flex flex-col gap-2">
        <p className="text-small text-muted">Learning path</p>
        <h1 className="break-words text-title">{path.title}</h1>
        {path.description && (
          <p className="whitespace-pre-line text-body text-muted">{path.description}</p>
        )}
      </div>
      <section
        aria-label="Your progress"
        className="flex flex-col gap-3 rounded border border-border bg-bg p-4"
      >
        <p className="text-body font-medium">{progressLine(progress)}</p>
        {progress.total > 0 && (
          <ProgressBar percent={progress.percent} label={`${path.title} progress`} />
        )}
        {next && (
          <Link
            to={courseHref(next.id)}
            className={buttonClasses({ className: 'self-start max-md:h-11' })}
          >
            {`${progress.status === 'not_started' ? 'Start' : 'Continue'}: ${next.title}`}
          </Link>
        )}
      </section>
      <section aria-labelledby={listId} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={listId} className="text-h2">
            Courses
          </h2>
          <p className="text-small text-muted">
            {path.order === 'sequential'
              ? 'Take them in order: each course opens once the ones before it are done.'
              : 'Take them in any order.'}
          </p>
        </div>
        {courses.length === 0 ? (
          <p className="text-body text-muted">This path has no courses you can open yet.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {courses.map((course, index) => (
              <li key={course.id}>
                <PathCourseCard course={course} step={index + 1} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

/** One course of the path. The whole card opens it, unless it's locked. */
function PathCourseCard({ course, step }: { course: PathCourse; step: number }) {
  return (
    <article
      className={cn(
        'relative flex gap-3 rounded border border-border bg-bg p-4 text-fg',
        !course.locked && 'hover:border-border-hover',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full text-small font-medium',
          FINISHED.has(course.status) ? 'bg-primary text-primary-fg' : 'bg-fill text-muted',
        )}
      >
        {step}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="break-words text-h3">
          {course.locked ? (
            course.title
          ) : (
            <Link
              to={courseHref(course.id)}
              className={cn(
                'after:absolute after:inset-0 after:rounded hover:underline',
                'focus-visible:outline-none focus-visible:after:ring-2',
                'focus-visible:after:ring-ring',
              )}
            >
              {course.title}
            </Link>
          )}
        </h3>
        {course.summary && <p className="text-small text-muted">{course.summary}</p>}
        {course.estimatedMinutes !== undefined && (
          <p className="text-small text-muted">{minutesText(course.estimatedMinutes)}</p>
        )}
        <p
          className={cn(
            'text-small font-medium',
            FINISHED.has(course.status)
              ? 'text-success'
              : course.status === 'failed'
                ? 'text-danger'
                : 'text-muted',
          )}
        >
          {course.locked
            ? 'Opens once the courses before it are done'
            : COURSE_STATUS_LABELS[course.status]}
        </p>
      </div>
    </article>
  );
}
