import { courseHref } from '@carehub/learning';
import { Button, Field, Input, cn } from '@carehub/ui';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { courseFacts } from '../course/start';
import { CourseCard } from './CourseCard';
import { catalogTopics, findCourses, type CatalogEntry } from './data';

/**
 * The catalog: every listed course, a search box and the topics. The search and the topic live
 * in the address (`?q=calls&topic=Phones`), so a search can be shared and Back keeps it.
 */
export function Catalog({ entries }: { entries: readonly CatalogEntry[] }) {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const topic = params.get('topic') ?? '';
  const topics = useMemo(() => catalogTopics(entries), [entries]);
  const shown = findCourses(entries, query, topic || undefined);
  const searching = query.trim() !== '' || topic !== '';

  const update = (change: { q?: string; topic?: string }) => {
    const next = new URLSearchParams();
    const values = { q: query, topic, ...change };
    if (values.q) next.set('q', values.q);
    if (values.topic) next.set('topic', values.topic);
    setParams(next, { replace: true });
  };

  return (
    <main
      className={cn(
        'mx-auto flex w-full max-w-page flex-col gap-6 px-4 py-6 text-fg',
        'md:px-6 md:py-10',
      )}
    >
      <title>Care Hub · Catalog</title>
      <div className="flex flex-col gap-2">
        <h1 className="text-title">Catalog</h1>
        <p className="text-body text-muted">Courses anyone in the workspace can take.</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-body text-muted">
          No courses in the catalog yet. They show up here once they're published.
        </p>
      ) : (
        <>
          <div role="search" className="flex flex-col gap-3">
            <Field label="Search courses">
              <Input
                type="search"
                value={query}
                placeholder="A title, a word or a topic"
                onChange={(event) => update({ q: event.target.value })}
              />
            </Field>
            {topics.length > 0 && (
              <div role="group" aria-label="Topics" className="flex flex-wrap gap-2">
                {['', ...topics].map((name) => (
                  <Button
                    key={name}
                    size="sm"
                    variant={topic === name ? 'primary' : 'secondary'}
                    aria-pressed={topic === name}
                    onClick={() => update({ topic: name })}
                  >
                    {name || 'All topics'}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <p role="status" className="text-small text-muted">
            {shown.length === 0
              ? 'No courses match your search.'
              : shown.length === 1
                ? '1 course'
                : `${shown.length} courses`}
          </p>
          {shown.length > 0 ? (
            <ul className="grid gap-4 sm:grid-cols-2">
              {shown.map((entry) => (
                <li key={entry.id}>
                  <CourseCard
                    title={entry.title}
                    href={courseHref(entry.id)}
                    summary={entry.summary}
                    facts={courseFacts(entry.lessonCount, entry.estimatedMinutes)}
                    topics={entry.topics}
                  />
                </li>
              ))}
            </ul>
          ) : (
            searching && (
              <Button
                variant="secondary"
                className="self-start"
                onClick={() => update({ q: '', topic: '' })}
              >
                Clear the search
              </Button>
            )
          )}
        </>
      )}
    </main>
  );
}
