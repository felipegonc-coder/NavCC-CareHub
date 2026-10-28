import { cn } from '@carehub/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

type CourseCardProps = {
  title: string;
  /** The course start page. */
  href: string;
  /** Router state for the link, such as `RESUME_STATE` to go on to where the learner stopped. */
  linkState?: unknown;
  summary?: string;
  /** Its size in a few words: "4 lessons · About 20 minutes". */
  facts?: string;
  topics?: readonly string[];
  /** The learner's status, due date or progress. */
  children?: ReactNode;
};

/**
 * A course on My learning or in the catalog. The whole card opens the start page (its title is
 * the link), so it is easy to tap on a phone.
 */
export function CourseCard({
  title,
  href,
  linkState,
  summary,
  facts,
  topics,
  children,
}: CourseCardProps) {
  return (
    <article
      className={cn(
        'relative flex h-full flex-col gap-2 rounded border border-border bg-bg p-4 text-fg',
        'hover:border-border-hover',
      )}
    >
      <h3 className="break-words text-h3">
        <Link
          to={href}
          state={linkState}
          className={cn(
            'after:absolute after:inset-0 after:rounded hover:underline focus-visible:outline-none',
            'focus-visible:after:ring-2 focus-visible:after:ring-ring',
          )}
        >
          {title}
        </Link>
      </h3>
      {summary && <p className="text-small text-muted">{summary}</p>}
      {facts && <p className="text-small text-muted">{facts}</p>}
      {topics && <TopicList topics={topics} />}
      {children}
    </article>
  );
}

/** A course's topics, as small tags. Nothing when it has none. */
export function TopicList({ topics }: { topics: readonly string[] }) {
  if (topics.length === 0) return null;
  return (
    <ul aria-label="Topics" className="flex flex-wrap gap-2">
      {topics.map((topic) => (
        <li key={topic} className="rounded-sm bg-fill px-2 py-0.5 text-small text-muted">
          {topic}
        </li>
      ))}
    </ul>
  );
}
