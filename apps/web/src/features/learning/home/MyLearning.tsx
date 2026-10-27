import { courseHref, type MyLearningEntry, type MyLearningResponse } from '@carehub/learning';
import { Button, buttonClasses, cn } from '@carehub/ui';
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CourseCard } from '../catalog/CourseCard';
import { useCatalog } from '../catalog/data';
import { courseFacts } from '../course/start';
import { ProgressBar } from '../player/ProgressBar';
import { dueLine, entryStatus } from './entry';

/** My learning's sections, in the order they show. Empty sections are left out. */
const SECTIONS = [
  { key: 'overdue', title: 'Overdue' },
  { key: 'continue', title: 'Continue' },
  { key: 'assigned', title: 'Assigned to you' },
  { key: 'finished', title: 'Finished' },
] as const;

/** How many catalog courses the home page shows; the catalog page has the rest. */
const CATALOG_PREVIEW = 6;

/**
 * The Learning home: the learner's courses (overdue, in progress, assigned, finished), then
 * courses from the catalog they haven't started.
 */
export function MyLearning({ learning }: { learning: MyLearningResponse }) {
  const mine = SECTIONS.flatMap(({ key }) => learning[key]);
  return (
    <main
      className={cn(
        'mx-auto flex w-full max-w-page flex-col gap-8 px-4 py-6 text-fg',
        'md:px-6 md:py-10',
      )}
    >
      <title>Care Hub · My learning</title>
      <h1 className="text-title">My learning</h1>
      {mine.length === 0 && (
        <p className="text-body text-muted">
          Nothing here yet. Courses assigned to you, and courses you start, show up here.
        </p>
      )}
      {SECTIONS.map(({ key, title }) =>
        learning[key].length > 0 ? (
          <Section key={key} title={title}>
            {learning[key].map((entry) => (
              <li key={entry.courseId}>
                <EntryCard entry={entry} />
              </li>
            ))}
          </Section>
        ) : null,
      )}
      <CatalogPreview skip={new Set(mine.map((entry) => entry.courseId))} />
    </main>
  );
}

type SectionProps = { title: string; children: ReactNode; after?: ReactNode };

/** A titled list of course cards, two across on wider screens; `after` follows the list. */
function Section({ title, children, after }: SectionProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-h2">
        {title}
      </h2>
      <ul className="grid gap-4 empty:hidden sm:grid-cols-2">{children}</ul>
      {after}
    </section>
  );
}

/** One of the learner's courses: where they are, whether it's required, and when it's due. */
function EntryCard({ entry }: { entry: MyLearningEntry }) {
  const due = dueLine(entry);
  return (
    <CourseCard
      title={entry.title}
      href={entry.href}
      summary={entry.summary}
      facts={entry.required ? 'Required' : undefined}
    >
      {due && (
        <p
          className={cn('text-small', entry.dueStatus === 'overdue' ? 'text-danger' : 'text-muted')}
        >
          {due}
        </p>
      )}
      <div className="mt-auto flex flex-col gap-2 pt-1">
        <p className="text-small font-medium">{entryStatus(entry)}</p>
        {entry.status === 'in_progress' && (
          <ProgressBar percent={entry.progressPercent} label={`${entry.title} progress`} />
        )}
      </div>
    </CourseCard>
  );
}

/** Courses from the catalog that aren't in My learning yet, and a way to see them all. */
function CatalogPreview({ skip }: { skip: ReadonlySet<string> }) {
  const catalog = useCatalog();
  const more = (catalog.data ?? []).filter((entry) => !skip.has(entry.id));
  const after = (
    <div className="flex flex-col items-start gap-3">
      {catalog.error ? (
        <>
          <p className="text-small text-muted">The catalog didn't load.</p>
          <Button variant="secondary" size="sm" onClick={() => void catalog.refetch()}>
            Try again
          </Button>
        </>
      ) : (
        catalog.data &&
        more.length === 0 && (
          <p className="text-small text-muted">
            {catalog.data.length === 0
              ? 'No courses in the catalog yet.'
              : 'Every course in the catalog is in My learning.'}
          </p>
        )
      )}
      <Link to="/learning/catalog" className={buttonClasses({ variant: 'secondary' })}>
        See the whole catalog
      </Link>
    </div>
  );
  return (
    <Section title="From the catalog" after={after}>
      {more.slice(0, CATALOG_PREVIEW).map((entry) => (
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
    </Section>
  );
}
