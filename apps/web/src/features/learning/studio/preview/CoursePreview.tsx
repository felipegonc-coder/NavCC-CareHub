import type { Id } from '@carehub/learning';
import { Button, buttonClasses, cn } from '@carehub/ui';
import { useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Link } from 'react-router';
import { RadioChoices } from '../choices';
import { usePreviewDraft } from '../data/queries';
import { editorPath } from '../labels';
import { ErrorState, LoadingState } from '../states';
import { LessonPreview } from './BlockPreview';

type PreviewWidth = 'computer' | 'phone';
const WIDTHS: readonly { value: PreviewWidth; label: string }[] = [
  { value: 'computer', label: 'Computer' },
  { value: 'phone', label: 'Phone' },
];

/**
 * The saved draft as learners will see it, at computer or phone width, a lesson at a time. Read-only, and
 * nothing counts as progress. The player takes over here when it lands.
 */
export function CoursePreview({ courseId }: { courseId: Id }): JSX.Element {
  const draft = usePreviewDraft(courseId);
  const [width, setWidth] = useState<PreviewWidth>('computer');
  const [current, setCurrent] = useState(0);
  const headingId = useId();
  const lessonHeading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  // After Previous, Next or a lesson in the list, focus the new lesson's title so reading starts there.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    lessonHeading.current?.focus();
  });

  if (!draft.data)
    return (
      <main className="mx-auto flex max-w-page flex-col gap-6 px-4 py-6 md:px-6">
        <title>Care Hub · Preview course</title>
        <h1 className="text-h1 text-fg">Preview course</h1>
        {draft.isError ? (
          <ErrorState error={draft.error} onRetry={() => void draft.refetch()} />
        ) : (
          <LoadingState label="Loading the preview" />
        )}
      </main>
    );

  const { course } = draft.data;
  const { lessons } = course;
  const index = Math.min(current, Math.max(lessons.length - 1, 0));
  const lesson = lessons[index];
  const narrow = width === 'phone';
  const go = (next: number) => {
    moved.current = true;
    setCurrent(next);
  };

  return (
    <main className="mx-auto flex max-w-page flex-col gap-6 px-4 py-6 md:px-6">
      <title>{`Care Hub · Preview of ${course.title}`}</title>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-small text-muted">
            Preview of the draft. Nothing here counts as progress.
          </p>
          <h1 className="text-h1 text-fg">{course.title}</h1>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <RadioChoices<PreviewWidth>
            legend="Width"
            compact
            value={width}
            options={WIDTHS}
            onChange={setWidth}
          />
          <Link
            to={editorPath(course.id)}
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            Back to the editor
          </Link>
        </div>
      </header>
      <section
        aria-label={narrow ? 'Preview at phone width' : 'Preview at computer width'}
        className={cn(
          'mx-auto flex w-full flex-col gap-6 rounded border border-border bg-bg p-4',
          narrow ? 'max-w-sm' : 'md:flex-row md:p-6',
        )}
      >
        {!lesson ? (
          <p className="text-body text-muted">
            This course has no lessons yet. Add one in the editor.
          </p>
        ) : (
          <>
            <nav
              aria-label="Lessons"
              className={cn('flex flex-col', !narrow && 'md:w-sidebar md:shrink-0')}
            >
              <ol className="flex flex-col gap-1">
                {lessons.map((item, i) => (
                  <li key={item.id}>
                    <Button
                      size="sm"
                      variant={i === index ? 'secondary' : 'ghost'}
                      className="w-full justify-start"
                      aria-current={i === index || undefined}
                      onClick={() => go(i)}
                    >
                      {`${i + 1}. ${item.title}`}
                    </Button>
                  </li>
                ))}
              </ol>
            </nav>
            <article aria-labelledby={headingId} className="flex min-w-0 flex-1 flex-col gap-4">
              <p className="text-small text-muted">{`Lesson ${index + 1} of ${lessons.length}`}</p>
              <h2 id={headingId} ref={lessonHeading} tabIndex={-1} className="text-h2 text-fg">
                {lesson.title}
              </h2>
              <LessonPreview lesson={lesson} narrow={narrow} />
              <div className="flex justify-between gap-3 border-t border-border pt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={index === 0}
                  onClick={() => go(index - 1)}
                >
                  Previous lesson
                </Button>
                <Button
                  size="sm"
                  disabled={index === lessons.length - 1}
                  onClick={() => go(index + 1)}
                >
                  Next lesson
                </Button>
              </div>
            </article>
          </>
        )}
      </section>
    </main>
  );
}
