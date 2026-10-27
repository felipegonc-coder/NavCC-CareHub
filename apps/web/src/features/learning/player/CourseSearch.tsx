import {
  COURSE_SEARCH_MIN_LENGTH,
  buildCourseSearchIndex,
  lessonHref,
  searchCourseIndex,
  type Course,
  type CourseSearchResult,
  type OutlineRow,
} from '@carehub/learning';
import { Field, Input, cn } from '@carehub/ui';
import { Fragment, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router';

type CourseSearchProps = {
  course: Course;
  /** The outline's rows, to mark results in locked lessons. */
  rows: readonly OutlineRow[];
  query: string;
  onQuery(query: string): void;
  /** Called when the learner opens a result, so the search can close. */
  onPick(): void;
};

/** What the search found, in a few words; empty until something is typed. */
export function searchSummary(query: string, result: CourseSearchResult): string {
  const words = query.trim();
  if (words === '') return '';
  if (result.tooShort) return `Type at least ${COURSE_SEARCH_MIN_LENGTH} letters.`;
  if (result.total === 0) return `Nothing in this course matches "${words}".`;
  const found = result.total === 1 ? '1 place matches' : `${result.total} places match`;
  if (result.hits.length < result.total)
    return `${found}. Here are the first ${result.hits.length}.`;
  return `${found}.`;
}

/**
 * Search inside the course: the places in its lessons where every typed word appears, each with a
 * snippet, in course order. Results in locked lessons are listed too; opening one says what to
 * finish first (0307).
 */
export function CourseSearch({ course, rows, query, onQuery, onPick }: CourseSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const index = useMemo(() => buildCourseSearchIndex(course), [course]);
  const result = useMemo(() => searchCourseIndex(index, query), [index, query]);
  const locked = new Set(rows.filter((row) => row.status === 'locked').map((row) => row.lessonId));
  return (
    <div role="search" className="flex flex-col gap-3">
      <Field label="Search this course">
        <Input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </Field>
      <p role="status" className="text-small text-muted">
        {searchSummary(query, result)}
      </p>
      {result.hits.length > 0 && (
        <ol aria-label="Results" className="flex max-h-96 flex-col gap-1 overflow-y-auto">
          {result.hits.map((hit) => (
            <li key={`${hit.lessonId} ${hit.blockId ?? ''}`}>
              <Link
                to={lessonHref(course.id, hit.lessonId, hit.blockId)}
                onClick={onPick}
                className={cn(
                  'flex flex-col gap-1 rounded px-3 py-2 text-fg hover:bg-fill-hover',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <span className="text-label text-muted">
                  Lesson {hit.lessonNumber}: {hit.lessonTitle}
                  {locked.has(hit.lessonId) && ' · Locked'}
                </span>
                <span className="break-words text-small">
                  {hit.snippet.map((part, at) =>
                    part.match ? (
                      <mark key={at} className="rounded-sm bg-warning/25 text-fg">
                        {part.text}
                      </mark>
                    ) : (
                      <Fragment key={at}>{part.text}</Fragment>
                    ),
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
