import {
  LIMITS,
  pathProblems,
  type Id,
  type LearningPath,
  type PathCourseCheck,
  type PathProblem,
} from '@carehub/learning';
import {
  Button,
  buttonClasses,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  IconButton,
  Input,
  Textarea,
  VisuallyHidden,
} from '@carehub/ui';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { LearningApiError } from '../../data';
import { pathHref } from '../../paths/data';
import { RadioChoices } from '../choices';
import type { StudioCourseSummary } from '../data/client';
import { useStudioCourses } from '../data/queries';
import { courseStateLabel, editorPath } from '../labels';
import { ErrorState, LoadingState } from '../states';
import {
  ORDER_CHOICES,
  PATHS_STUDIO,
  pathErrorText,
  pathToSave,
  samePath,
  useDeletePath,
  useSavePath,
  useStudioPath,
} from './data';
import { BackLink, PathError } from './parts';

/** How many courses Add courses offers at once; search finds the others. */
const OFFERED = 8;

const courseTitle = (course: Pick<StudioCourseSummary, 'title'>): string =>
  course.title.trim() || 'Untitled course';

/** Every Studio course, in use and archived, and what `pathProblems` needs to know about each. */
function useCourses() {
  const active = useStudioCourses(false);
  const archived = useStudioCourses(true);
  const all = [...(active.data ?? []), ...(archived.data ?? [])];
  return {
    ready: active.isSuccess && archived.isSuccess,
    error: active.isError ? active.error : archived.isError ? archived.error : null,
    retry: () => {
      void active.refetch();
      void archived.refetch();
    },
    active: active.data ?? [],
    byId: new Map(all.map((course) => [course.id, course] as const)),
    checks: all.map((course): PathCourseCheck => ({
      id: course.id,
      title: courseTitle(course),
      live: course.version !== null,
      archived: course.archived,
    })),
  };
}

type Courses = ReturnType<typeof useCourses>;

/** Asks before the tab is closed or reloaded with unsaved changes. */
function useLeaveWarning(unsaved: boolean) {
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
}

type CourseListProps = {
  courseIds: readonly Id[];
  courses: Courses;
  onChange(courseIds: Id[], notice: string): void;
};

/** The path's courses in order, each with Move up, Move down and Remove. */
function PathCourseList({ courseIds, courses, onChange }: CourseListProps) {
  const titleOf = (courseId: Id, index: number) => {
    const course = courses.byId.get(courseId);
    return course ? courseTitle(course) : `Course ${index + 1}`;
  };
  const move = (from: number, to: number) => {
    const next = [...courseIds];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    onChange(next, `Moved “${titleOf(moved, from)}” to number ${to + 1}.`);
  };
  if (courseIds.length === 0) {
    return <p className="text-body text-muted">No courses yet. Add them below.</p>;
  }
  return (
    <ol className="flex flex-col gap-2">
      {courseIds.map((courseId, index) => {
        const course = courses.byId.get(courseId);
        const title = titleOf(courseId, index);
        const state = course
          ? course.archived
            ? 'Archived'
            : courseStateLabel(course)
          : courses.ready
            ? 'Deleted'
            : 'Loading…';
        return (
          <li key={courseId} className="flex items-center gap-3 rounded border border-border p-3">
            <span aria-hidden className="w-6 text-center text-small text-muted">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              {course ? (
                <Link
                  to={editorPath(courseId)}
                  className="text-body font-semibold text-fg hover:underline"
                >
                  {title}
                </Link>
              ) : (
                <p className="text-body font-semibold text-fg">{title}</p>
              )}
              <p className="text-small text-muted">{state}</p>
            </div>
            <IconButton
              label={`Move ${title} up`}
              size="sm"
              disabled={index === 0}
              onClick={() => move(index, index - 1)}
            >
              <ArrowUp aria-hidden />
            </IconButton>
            <IconButton
              label={`Move ${title} down`}
              size="sm"
              disabled={index === courseIds.length - 1}
              onClick={() => move(index, index + 1)}
            >
              <ArrowDown aria-hidden />
            </IconButton>
            <IconButton
              label={`Remove ${title}`}
              size="sm"
              onClick={() =>
                onChange(
                  courseIds.filter((id) => id !== courseId),
                  `Removed “${title}”.`,
                )
              }
            >
              <X aria-hidden />
            </IconButton>
          </li>
        );
      })}
    </ol>
  );
}

type AddCoursesProps = {
  courseIds: readonly Id[];
  courses: Courses;
  onAdd(course: StudioCourseSummary): void;
};

/** Finds Studio courses (not archived ones) by title, to add at the end of the path. */
function AddCourses({ courseIds, courses, onAdd }: AddCoursesProps) {
  const [search, setSearch] = useState('');
  if (courses.error) return <ErrorState error={courses.error} onRetry={courses.retry} />;
  if (!courses.ready) return <LoadingState label="Loading courses" />;
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const offered = courses.active.filter(
    (course) =>
      !courseIds.includes(course.id) &&
      words.every((word) => courseTitle(course).toLowerCase().includes(word)),
  );
  const full = courseIds.length >= LIMITS.pathCourses;
  return (
    <>
      <Field label="Search courses">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </Field>
      {full && (
        <p className="text-small text-muted">
          {`A path holds up to ${LIMITS.pathCourses} courses.`}
        </p>
      )}
      {offered.length === 0 ? (
        <p className="text-small text-muted">
          {words.length > 0
            ? `No courses match “${search.trim()}”.`
            : courses.active.length === 0
              ? 'No courses in Studio yet.'
              : 'Every course is in this path.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {offered.slice(0, OFFERED).map((course) => (
            <li key={course.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-small font-semibold text-fg">{courseTitle(course)}</p>
                <p className="text-small text-muted">{courseStateLabel(course)}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Add ${courseTitle(course)}`}
                disabled={full}
                onClick={() => onAdd(course)}
              >
                <Plus aria-hidden />
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
      {offered.length > OFFERED && (
        <p className="text-small text-muted">
          {`Showing ${OFFERED} of ${offered.length}. Search to find the others.`}
        </p>
      )}
    </>
  );
}

/** Whether the path can be assigned, and what to fix first. */
function Readiness({ problems }: { problems: readonly PathProblem[] }) {
  return (
    <section
      aria-label="Ready to assign"
      className="flex flex-col gap-2 rounded border border-border p-4"
    >
      {problems.length === 0 ? (
        <p className="text-small text-success">Ready to assign.</p>
      ) : (
        <>
          <p className="text-small font-medium text-fg">Before you assign this path:</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-fg">
            {problems.map((problem) => (
              <li key={problem.path}>{problem.message}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Delete, after asking. Then back to the path list, which says it was deleted. */
function DeletePath({ path }: { path: LearningPath }) {
  const navigate = useNavigate();
  const remove = useDeletePath();
  const done = `Deleted “${path.title}”.`;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Delete “${path.title}”?`}</DialogTitle>
          <DialogDescription>
            Its courses are no longer assigned through it, and people keep the progress they made.
            You can't undo this.
          </DialogDescription>
        </DialogHeader>
        {remove.isError && (
          <p role="alert" className="text-small text-danger">
            {`The path wasn't deleted. ${pathErrorText(remove.error)}`}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() =>
              remove.mutate(path.id, {
                onSuccess: () => void navigate(PATHS_STUDIO, { state: { done } }),
              })
            }
          >
            Delete path
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The builder for a loaded path: title, description, order and courses, saved with Save. Saving
 * changes who gets which course, so it doesn't happen on every click.
 */
function PathBuilder({ loaded }: { loaded: LearningPath }) {
  const id = useId();
  const [draft, setDraft] = useState(loaded);
  const [saved, setSaved] = useState(loaded);
  const [notice, setNotice] = useState('');
  const save = useSavePath();
  const courses = useCourses();
  const unsaved = !samePath(draft, saved);
  const titleMissing = draft.title.trim() === '';
  useLeaveWarning(unsaved);
  const change = (next: Partial<LearningPath>) => setDraft((path) => ({ ...path, ...next }));
  const setCourses = (courseIds: Id[], message: string) => {
    change({ courseIds });
    setNotice(message);
  };
  const status = save.isPending ? 'Saving…' : unsaved ? 'Unsaved changes' : 'All changes saved';

  return (
    <main className="mx-auto flex max-w-page flex-col gap-6 px-6 py-8">
      <title>{`Care Hub · ${saved.title}`}</title>
      <BackLink to={PATHS_STUDIO}>Learning paths</BackLink>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-small text-muted">Learning path</p>
          <h1 className="break-words text-title text-fg">
            {draft.title.trim() || 'Untitled path'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-small text-muted">
            {status}
          </p>
          <Link to={pathHref(saved.id)} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
            View as learner
          </Link>
          <DeletePath path={saved} />
          <Button
            size="sm"
            loading={save.isPending}
            disabled={!unsaved || titleMissing}
            onClick={() => save.mutate(pathToSave(draft), { onSuccess: (path) => setSaved(path) })}
          >
            Save
          </Button>
        </div>
      </div>
      {save.isError && (
        <p role="alert" className="text-small text-danger">
          {`The path wasn't saved. ${pathErrorText(save.error)}`}
        </p>
      )}
      <div className="flex flex-col gap-4">
        <Field label="Title" required error={titleMissing ? 'Give the path a title.' : undefined}>
          <Input
            value={draft.title}
            maxLength={LIMITS.title}
            onChange={(event) => change({ title: event.currentTarget.value })}
          />
        </Field>
        <Field label="Description" hint="Optional. Learners see it at the top of the path.">
          <Textarea
            rows={3}
            value={draft.description ?? ''}
            maxLength={LIMITS.pathDescription}
            onChange={(event) => change({ description: event.currentTarget.value })}
          />
        </Field>
        <RadioChoices
          legend="Order"
          value={draft.order}
          options={ORDER_CHOICES}
          onChange={(order) => change({ order })}
        />
      </div>
      <section aria-labelledby={`${id}-courses`} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`${id}-courses`} className="text-h2 text-fg">
            Courses
          </h2>
          <p className="text-small text-muted">
            {`${draft.courseIds.length} of ${LIMITS.pathCourses}`}
          </p>
        </div>
        <p className="text-small text-muted">
          When you save, the people this path is assigned to get the courses you added. Courses you
          removed are no longer assigned through it.
        </p>
        <PathCourseList courseIds={draft.courseIds} courses={courses} onChange={setCourses} />
      </section>
      <section aria-labelledby={`${id}-add`} className="flex flex-col gap-3">
        <h2 id={`${id}-add`} className="text-h2 text-fg">
          Add courses
        </h2>
        <AddCourses
          courseIds={draft.courseIds}
          courses={courses}
          onAdd={(course) =>
            setCourses([...draft.courseIds, course.id], `Added “${courseTitle(course)}”.`)
          }
        />
      </section>
      {courses.ready && <Readiness problems={pathProblems(draft, courses.checks)} />}
      <VisuallyHidden aria-live="polite">{notice}</VisuallyHidden>
    </main>
  );
}

/** A path that didn't load: deleted, a wrong link, no access, or offline (with Retry). */
export function PathMissing({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const gone = error instanceof LearningApiError && error.status === 404;
  return (
    <main className="mx-auto flex max-w-page flex-col gap-6 px-6 py-8">
      <title>{`Care Hub · ${gone ? 'Learning path not found' : 'Edit learning path'}`}</title>
      <BackLink to={PATHS_STUDIO}>Learning paths</BackLink>
      <h1 className="text-title text-fg">
        {gone ? 'Learning path not found' : "This path didn't load"}
      </h1>
      <PathError error={error} onRetry={onRetry} />
    </main>
  );
}

/** `/learning/studio/paths/:pathId` once the id is checked: loads the path, then the builder. */
export function PathEditor({ pathId }: { pathId: Id }) {
  const path = useStudioPath(pathId);
  if (path.data) return <PathBuilder loaded={path.data} />;
  if (path.isError) {
    return <PathMissing error={path.error} onRetry={() => void path.refetch()} />;
  }
  return (
    <main className="mx-auto flex max-w-page flex-col gap-6 px-6 py-8">
      <title>Care Hub · Edit learning path</title>
      <LoadingState label="Loading the learning path" />
    </main>
  );
}
