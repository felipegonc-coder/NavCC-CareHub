import { Button, Field, Input } from '@carehub/ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { StudioCourseSummary } from '../data/client';
import { useCourseAction, useStudioCourses } from '../data/queries';
import type { CourseAction } from '../data/queries';
import { COURSE_TYPE_INFO, courseStateLabel, editorPath } from '../labels';
import { ErrorState, LoadingState } from '../states';
import { NewCourse } from './NewCourse';

type Filter = 'all' | 'draft' | 'live' | 'archived';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'live', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

const DONE: Record<CourseAction, (title: string) => string> = {
  duplicate: (title) => `Copied “${title}”. The copy is a draft.`,
  archive: (title) => `Archived “${title}”. Find it under Archived.`,
  unarchive: (title) => `“${title}” is back with your courses.`,
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** Courses matching the filter and every word of the search. */
function visible(courses: StudioCourseSummary[], filter: Filter, search: string) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return courses.filter(
    (course) =>
      (filter === 'draft'
        ? course.state === 'draft'
        : filter !== 'live' || course.state !== 'draft') &&
      words.every((word) => course.title.toLowerCase().includes(word)),
  );
}

/** `/learning/studio`: drafts, published and archived courses, with search, New course and course actions. */
export function CourseList() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState('');
  const courses = useStudioCourses(filter === 'archived');
  const action = useCourseAction();
  const shown = visible(courses.data ?? [], filter, search);
  const run = (kind: CourseAction, course: StudioCourseSummary) =>
    action.mutate(
      { action: kind, courseId: course.id },
      { onSuccess: () => setDone(DONE[kind](course.title)) },
    );

  return (
    <main className="mx-auto flex max-w-page flex-col gap-6 px-6 py-8">
      <title>Care Hub · Studio</title>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title text-fg">Studio</h1>
        <Button aria-expanded={creating} onClick={() => setCreating(!creating)}>
          <Plus aria-hidden />
          New course
        </Button>
      </div>
      {creating && <NewCourse onClose={() => setCreating(false)} />}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search courses" className="min-w-48 flex-1">
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1">
          {FILTERS.map(({ value, label }) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? 'secondary' : 'ghost'}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <p role="status" className="text-small text-muted">
        {done}
      </p>
      {action.isError && (
        <p role="alert" className="text-small text-danger">
          That didn't work. Try again.
        </p>
      )}
      {courses.isPending ? (
        <LoadingState label="Loading courses" />
      ) : courses.isError ? (
        <ErrorState error={courses.error} onRetry={() => void courses.refetch()} />
      ) : shown.length === 0 ? (
        <p className="text-body text-muted">
          {search.trim()
            ? `No courses match “${search.trim()}”.`
            : filter === 'archived'
              ? 'No archived courses.'
              : filter === 'all'
                ? 'No courses yet. Start one with New course.'
                : 'No courses here yet.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((course) => (
            <li
              key={course.id}
              className="flex flex-wrap items-center gap-3 rounded border border-border p-4"
            >
              <div className="min-w-0 flex-1">
                <Link
                  to={editorPath(course.id)}
                  className="text-body font-semibold text-fg hover:underline"
                >
                  {course.title}
                </Link>
                <p className="text-small text-muted">
                  {COURSE_TYPE_INFO[course.type].label} · {courseStateLabel(course)} · Edited{' '}
                  {dateFormat.format(new Date(course.updatedAt))}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Duplicate ${course.title}`}
                disabled={action.isPending}
                onClick={() => run('duplicate', course)}
              >
                Duplicate
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`${course.archived ? 'Unarchive' : 'Archive'} ${course.title}`}
                disabled={action.isPending}
                onClick={() => run(course.archived ? 'unarchive' : 'archive', course)}
              >
                {course.archived ? 'Unarchive' : 'Archive'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
