import {
  blockAnchorId,
  blockIdFromHash,
  canCompleteLesson,
  courseHref,
  lessonHref,
  nextLesson,
  playerLabels,
  previousLessonId,
  visibleBlocks,
  type Course,
  type Link as CourseLink,
  type LearnerCourseState,
  type Lesson,
  type NewProgressEvent,
  type OutlineRow,
} from '@carehub/learning';
import { Button, buttonClasses } from '@carehub/ui';
import { ArrowLeft, ArrowRight, Lock } from 'lucide-react';
import { useEffect, useId, useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { BlockView, type BlockViewMode } from '../blocks/registry';
import { withPending } from './pending';
import { useActiveTime } from './useActiveTime';

export type LessonViewProps = {
  course: Course;
  lesson: Lesson;
  /** The lesson's outline row: its number, state and, when locked, why. */
  row: OutlineRow;
  state: LearnerCourseState;
  mode: BlockViewMode;
  emit(event: NewProgressEvent): void;
  go(link: CourseLink): void;
};

const noteClasses = 'rounded border border-border bg-fill px-4 py-3 text-small text-muted';

/**
 * One lesson: its title, the blocks up to the first continue block not passed yet, and the way on
 * once the end is reached. Give it `key={lesson.id}` so each lesson starts fresh.
 */
export function LessonView({ course, lesson, row, state, mode, emit, go }: LessonViewProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { hash } = useLocation();
  const locked = row.status === 'locked';
  const completedIds = state.lessons.find(
    (entry) => entry.lessonId === lesson.id,
  )?.completedBlockIds;
  const blocks = useMemo(
    () => (lesson.kind === 'content' ? visibleBlocks(lesson, completedIds ?? []) : []),
    [lesson, completedIds],
  );

  const time = useActiveTime(mode === 'learn' && !locked ? lesson.id : null, emit);

  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || mode !== 'learn' || locked) return;
    opened.current = true;
    emit({ type: 'lesson_opened', lessonId: lesson.id });
  }, [emit, lesson.id, locked, mode]);

  // A link to a block lands on it; otherwise the lesson title, so screen readers start there.
  useEffect(() => {
    const blockId = blockIdFromHash(hash);
    const target = blockId === null ? null : document.getElementById(blockAnchorId(blockId));
    (target ?? titleRef.current)?.focus();
  }, [hash]);

  // After a continue block, the first block it reveals.
  const shown = useRef(blocks.length);
  useEffect(() => {
    const before = shown.current;
    shown.current = blocks.length;
    const revealed = blocks.length > before ? blocks[before] : undefined;
    if (revealed) document.getElementById(blockAnchorId(revealed.id))?.focus();
  }, [blocks]);

  const ended = locked || lesson.kind !== 'content' || blocks.length === lesson.blocks.length;
  // A link (or search result) to a block still behind a continue block lands on the lesson title.
  const wanted = blockIdFromHash(hash);
  const ahead =
    wanted !== null &&
    !locked &&
    lesson.kind === 'content' &&
    lesson.blocks.some((block) => block.id === wanted) &&
    !blocks.some((block) => block.id === wanted);
  return (
    <article className="mx-auto flex w-full max-w-page flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-small text-muted">
          Lesson {row.number} of {course.lessons.length}
        </p>
        <h1 ref={titleRef} tabIndex={-1} className="text-title text-fg focus:outline-none">
          {lesson.title}
        </h1>
      </header>
      {ahead && (
        <p className={noteClasses}>
          What you&apos;re looking for comes further on in this lesson. Carry on to reach it.
        </p>
      )}
      {locked ? (
        <p className={`flex items-center gap-2 ${noteClasses}`}>
          <Lock aria-hidden className="size-4 shrink-0" />
          {row.lockedReason ?? "This lesson isn't open yet."}
        </p>
      ) : lesson.kind === 'content' ? (
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
                mode={mode}
                state={state}
                emit={emit}
                go={go}
              />
            </div>
          ))}
        </div>
      ) : (
        <p className={noteClasses}>This quiz can&apos;t be shown here yet.</p>
      )}
      {ended && (
        <LessonEnd
          course={course}
          lesson={lesson}
          state={state}
          locked={locked}
          emit={emit}
          time={time}
        />
      )}
    </article>
  );
}

type LessonEndProps = Pick<LessonViewProps, 'course' | 'lesson' | 'state' | 'emit'> & {
  locked: boolean;
  time: ReturnType<typeof useActiveTime>;
};

/** Previous, and Next (completing the lesson first when it can be completed). */
function LessonEnd({ course, lesson, state, locked, emit, time }: LessonEndProps) {
  const navigate = useNavigate();
  const hintId = useId();
  const labels = playerLabels(course);
  const previous = previousLessonId(course, lesson.id);
  const done = state.lessons.some(
    (entry) => entry.lessonId === lesson.id && entry.status === 'completed',
  );
  const completing = lesson.kind === 'content' && !done && !locked;
  // Time counted but not sent yet counts too; it's sent just before the lesson is completed.
  const counted =
    time.unsentSeconds > 0
      ? withPending(course, state, [
          {
            type: 'time_active',
            lessonId: lesson.id,
            seconds: time.unsentSeconds,
            id: 'unsent',
            at: '',
          },
        ])
      : state;
  const check = completing ? canCompleteLesson(course, counted, lesson.id) : null;
  // Where Next goes once this lesson counts as completed (the next lesson may unlock).
  const after = completing
    ? withPending(course, state, [
        { type: 'lesson_completed', lessonId: lesson.id, id: 'next', at: '' },
      ])
    : state;
  const next = locked ? null : nextLesson(course, after, lesson.id);
  const hint =
    check && !check.ok && check.reason === 'minimum_time'
      ? `Stay with this lesson a little longer to finish it (${timeLeft(check.secondsLeft)} left).`
      : null;

  const action = () => {
    if (check?.ok) {
      time.flush();
      emit({ type: 'lesson_completed', lessonId: lesson.id });
    }
    if (next) navigate(lessonHref(course.id, next));
    else if (done) navigate(courseHref(course.id));
  };
  const showAction = !locked && (next !== null || lesson.kind === 'content');
  return (
    <nav
      aria-label="Lessons"
      className="flex flex-wrap items-start gap-3 border-t border-border pt-6"
    >
      {previous && (
        <Link
          to={lessonHref(course.id, previous)}
          className={buttonClasses({ variant: 'secondary', className: 'max-md:h-11' })}
        >
          <ArrowLeft aria-hidden />
          Previous lesson
        </Link>
      )}
      {showAction && (
        <div className="ml-auto flex flex-col items-end gap-1">
          <Button
            onClick={action}
            disabled={check !== null && !check.ok}
            aria-describedby={hint ? hintId : undefined}
            className="max-md:h-11"
          >
            {next ? labels.next : done ? 'Back to the course' : labels.complete}
            {next && <ArrowRight aria-hidden />}
          </Button>
          {hint && (
            <p id={hintId} className="text-small text-muted">
              {hint}
            </p>
          )}
        </div>
      )}
    </nav>
  );
}

/**
 * A lesson's time left: whole minutes, rounded up, then seconds in the last minute, so the hint
 * counts down as the active time is counted (every few seconds).
 */
function timeLeft(seconds = 0): string {
  if (seconds < 60) {
    const count = Math.max(1, Math.ceil(seconds));
    return count === 1 ? '1 second' : `${count} seconds`;
  }
  const count = Math.ceil(seconds / 60);
  return count === 1 ? '1 minute' : `${count} minutes`;
}
