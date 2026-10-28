import {
  blockAnchorId,
  linkTarget,
  reduceProgress,
  visibleBlocks,
  type Course,
  type Id,
  type Lesson,
  type LearnerCourseState,
  type Link as CourseLink,
  type NewProgressEvent,
  type ProgressEvent,
} from '@carehub/learning';
import { Button, buttonClasses, cn } from '@carehub/ui';
import { RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Link } from 'react-router';
import { BlockView } from '../../blocks/registry';
import { RadioChoices } from '../choices';
import { usePreviewDraft } from '../data/queries';
import { editorPath } from '../labels';
import { ErrorState, LoadingState } from '../states';

type PreviewWidth = 'computer' | 'phone';
const WIDTHS: readonly { value: PreviewWidth; label: string }[] = [
  { value: 'computer', label: 'Computer' },
  { value: 'phone', label: 'Phone' },
];

const noteClasses = 'rounded border border-border bg-fill px-4 py-3 text-small text-muted';

/**
 * The saved draft as learners will see it, at computer or phone width, a lesson at a time, through
 * the player's block views. Continue blocks and activities work, but nothing is saved and nothing
 * counts as progress.
 */
export function CoursePreview({ courseId }: { courseId: Id }): JSX.Element {
  const draft = usePreviewDraft(courseId);
  if (draft.data) return <Preview course={draft.data.course} />;
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
}

/** Ids in the order things happen, so two events in the same millisecond keep their order. */
const previewEventId = (index: number) => `preview-${String(index + 1).padStart(6, '0')}`;

/** Where focus goes after opening a lesson: a block in it, or else its title. */
type FocusRequest = { blockId?: Id };

function Preview({ course }: { course: Course }) {
  const [width, setWidth] = useState<PreviewWidth>('computer');
  const [lessonId, setLessonId] = useState<Id | undefined>(course.lessons[0]?.id);
  const [events, setEvents] = useState<readonly ProgressEvent[]>([]);
  // Start again shows every lesson fresh, so a lesson's own state (ticked items…) resets too.
  const [run, setRun] = useState(0);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  // Every lesson is open in the preview, whatever order the course asks for.
  const anyOrder = useMemo<Course>(
    () => ({ ...course, settings: { ...course.settings, lessonOrder: 'free' } }),
    [course],
  );
  const state = useMemo(() => reduceProgress(anyOrder, events), [anyOrder, events]);
  const emit = useCallback((event: NewProgressEvent) => {
    setEvents((list) => [
      ...list,
      { ...event, id: previewEventId(list.length), at: new Date().toISOString() },
    ]);
  }, []);
  const open = useCallback((id: Id, blockId?: Id) => {
    setLessonId(id);
    setFocus(blockId === undefined ? {} : { blockId });
  }, []);
  // Lesson links stay in the preview; Care Hub pages and web links open in a new tab.
  const go = useCallback(
    (link: CourseLink) => {
      const target = linkTarget(course, link);
      if (target.kind === 'lesson') open(target.lessonId, target.blockId);
      else if (target.kind === 'external' && !target.newTab) window.location.assign(target.href);
      else if (target.kind !== 'broken') window.open(target.href, '_blank', 'noopener,noreferrer');
    },
    [course, open],
  );
  const focused = useCallback(() => setFocus(null), []);
  const restart = () => {
    setEvents([]);
    setRun((count) => count + 1);
  };

  const { lessons } = course;
  const index = Math.max(
    0,
    lessons.findIndex((lesson) => lesson.id === lessonId),
  );
  const lesson = lessons[index];
  const narrow = width === 'phone';
  return (
    <main className="mx-auto flex max-w-page flex-col gap-6 px-4 py-6 md:px-6">
      <title>{`Care Hub · Preview of ${course.title}`}</title>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-small text-muted">
            Preview of the draft. Nothing here is saved or counts as progress.
          </p>
          <p className="text-h3 font-semibold text-fg">{course.title}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <RadioChoices<PreviewWidth>
            legend="Width"
            compact
            value={width}
            options={WIDTHS}
            onChange={setWidth}
          />
          <Button variant="secondary" size="sm" onClick={restart}>
            <RotateCcw aria-hidden />
            Start again
          </Button>
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
          narrow ? 'max-w-96' : 'md:flex-row md:p-6',
        )}
      >
        {!lesson ? (
          <div className="flex flex-col gap-2">
            <h1 className="text-title text-fg">Nothing to preview yet</h1>
            <p className="text-body text-muted">
              This course has no lessons yet. Add one in the editor.
            </p>
          </div>
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
                      onClick={() => open(item.id)}
                    >
                      {`${i + 1}. ${item.title}`}
                    </Button>
                  </li>
                ))}
              </ol>
            </nav>
            <LessonPreview
              key={`${lesson.id}/${run}`}
              course={course}
              lesson={lesson}
              number={index + 1}
              state={state}
              emit={emit}
              go={go}
              focus={focus}
              onFocused={focused}
              onOpen={open}
            />
          </>
        )}
      </section>
    </main>
  );
}

type LessonPreviewProps = {
  course: Course;
  lesson: Lesson;
  number: number;
  state: LearnerCourseState;
  emit(event: NewProgressEvent): void;
  go(link: CourseLink): void;
  focus: FocusRequest | null;
  onFocused(): void;
  onOpen(lessonId: Id): void;
};

/** One lesson: its title, the blocks up to the first continue block not passed, and the way on. */
function LessonPreview(props: LessonPreviewProps) {
  const { course, lesson, number, state, emit, go, focus, onFocused, onOpen } = props;
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const done = state.lessons.find((entry) => entry.lessonId === lesson.id)?.completedBlockIds;
  const blocks = useMemo(
    () => (lesson.kind === 'content' ? visibleBlocks(lesson, done ?? []) : []),
    [lesson, done],
  );

  // After opening a lesson: the block a link asked for if it shows, else the lesson title.
  useEffect(() => {
    if (!focus) return;
    onFocused();
    const { blockId } = focus;
    const target = blockId === undefined ? null : document.getElementById(blockAnchorId(blockId));
    (target ?? titleRef.current)?.focus();
  }, [focus, onFocused]);

  // After a continue block, the first block it shows.
  const shown = useRef(blocks.length);
  useEffect(() => {
    const before = shown.current;
    shown.current = blocks.length;
    const revealed = blocks.length > before ? blocks[before] : undefined;
    if (revealed) document.getElementById(blockAnchorId(revealed.id))?.focus();
  }, [blocks]);

  const previous = course.lessons[number - 2];
  const next = course.lessons[number];
  return (
    <article aria-labelledby={titleId} className="flex min-w-0 flex-1 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-small text-muted">{`Lesson ${number} of ${course.lessons.length}`}</p>
        <h1
          id={titleId}
          ref={titleRef}
          tabIndex={-1}
          className="text-title text-fg focus:outline-none"
        >
          {lesson.title}
        </h1>
      </header>
      {lesson.kind === 'quiz' ? (
        <p className={noteClasses}>
          This is a quiz. Quizzes can&apos;t be tried in the preview yet.
        </p>
      ) : blocks.length === 0 ? (
        <p className={noteClasses}>This lesson has no blocks yet.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {blocks.map((block) => (
            <div
              key={block.id}
              id={blockAnchorId(block.id)}
              tabIndex={-1}
              className="scroll-mt-4 focus:outline-none"
            >
              <BlockView
                block={block}
                lesson={lesson}
                course={course}
                mode="preview"
                state={state}
                emit={emit}
                go={go}
              />
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-between gap-3 border-t border-border pt-4">
        <Button
          variant="secondary"
          size="sm"
          disabled={!previous}
          onClick={() => previous && onOpen(previous.id)}
        >
          Previous lesson
        </Button>
        <Button size="sm" disabled={!next} onClick={() => next && onOpen(next.id)}>
          Next lesson
        </Button>
      </div>
    </article>
  );
}
