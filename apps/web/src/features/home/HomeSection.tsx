import { Button, buttonClasses, Skeleton, VisuallyHidden } from '@carehub/ui';
import { Component, useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

/** What a section's data hook gives. A React Query result fits. */
export interface SectionQuery<T> {
  data: readonly T[] | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => unknown;
}

/** `query` with its data swapped, for example filtered or merged. */
export function withData<T>(
  query: SectionQuery<unknown>,
  data: readonly T[] | undefined,
): SectionQuery<T> {
  const { isPending, isError, isFetching, refetch } = query;
  return { data, isPending, isError, isFetching, refetch };
}

/** A row that opens something: Tab stops on it and Enter opens it. 44 px tall on a phone. */
export const rowClasses =
  'flex min-w-0 flex-1 items-center gap-3 rounded px-2 py-1.5 text-small text-fg hover:bg-fill-hover max-md:min-h-11';

export interface SectionLink {
  label: string;
  to: string;
  /** Finishes the link's name for screen readers: "See all" + "reminders". */
  hint?: string;
}

export interface HomeSectionProps<T> {
  title: string;
  /** Beside the heading: Open Calendar, See all. */
  link: SectionLink;
  query: SectionQuery<T>;
  /** The most items to show. */
  limit: number;
  /** When there's nothing to show: "You're all caught up." */
  empty: string;
  /** What it lists, for "Loading …" and "Couldn't load …": "upcoming events". */
  noun: string;
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** Splits the list under small headings, such as Today and Tomorrow. */
  groupOf?: (item: T) => string;
}

/** Loading this long shows the skeleton (decision 0007, section 5.1). */
const SKELETON_DELAY_MS = 300;

/**
 * One Home section: a region named by its heading, with its own loading, error and empty
 * states, so one that fails never holds up the others (HR-05).
 */
export function HomeSection<T>(props: HomeSectionProps<T>) {
  const { title, link, query, limit, empty, noun } = props;
  const headingId = useId();
  const showSkeleton = useDelayed(query.isPending, SKELETON_DELAY_MS);
  let body: ReactNode = null;
  if (query.data) {
    const items = query.data.slice(0, limit);
    body =
      items.length === 0 ? (
        <p className="px-2 py-1.5 text-small text-muted">{empty}</p>
      ) : (
        <SectionItems {...props} items={items} />
      );
  } else if (query.isError) {
    body = (
      <div role="alert" className="flex flex-wrap items-center gap-3 px-2 py-1.5">
        <p className="text-small text-fg">{`Couldn't load ${noun}.`}</p>
        <Button
          size="sm"
          variant="secondary"
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Retry
        </Button>
      </div>
    );
  } else if (showSkeleton) {
    body = <SectionSkeleton noun={noun} />;
  }
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-2 rounded border border-border bg-bg p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-body font-semibold text-fg">
          {title}
        </h2>
        <Link to={link.to} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
          {link.label}
          {link.hint && <VisuallyHidden>{` ${link.hint}`}</VisuallyHidden>}
        </Link>
      </div>
      {body}
    </section>
  );
}

function SectionItems<T>({
  items,
  itemKey,
  renderItem,
  groupOf,
}: HomeSectionProps<T> & { items: readonly T[] }) {
  const list = (group: readonly T[]) => (
    <ul className="flex flex-col">
      {group.map((item) => (
        <li key={itemKey(item)} className="flex min-w-0">
          {renderItem(item)}
        </li>
      ))}
    </ul>
  );
  if (!groupOf) return list(items);
  return (
    <div className="flex flex-col gap-2">
      {groupItems(items, groupOf).map(([label, group]) => (
        <div key={label} className="flex flex-col gap-1">
          <h3 className="px-2 text-label font-medium text-muted">{label}</h3>
          {list(group)}
        </div>
      ))}
    </div>
  );
}

/** Runs of items under the same label, in order. */
function groupItems<T>(items: readonly T[], groupOf: (item: T) => string): [string, T[]][] {
  const groups: [string, T[]][] = [];
  for (const item of items) {
    const label = groupOf(item);
    const last = groups.at(-1);
    if (last && last[0] === label) last[1].push(item);
    else groups.push([label, [item]]);
  }
  return groups;
}

function SectionSkeleton({ noun }: { noun: string }) {
  return (
    <div role="status" className="flex flex-col gap-3 px-2 py-1.5">
      <VisuallyHidden>{`Loading ${noun}`}</VisuallyHidden>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

/** `active`, but only once it has lasted `ms`. */
function useDelayed(active: boolean, ms: number): boolean {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setWaited(true), ms);
    return () => {
      clearTimeout(timer);
      setWaited(false);
    };
  }, [active, ms]);
  return active && waited;
}

interface BoundaryProps {
  title: string;
  children: ReactNode;
}

/** Keeps a section that breaks while drawing from taking Home down with it. */
export class SectionBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section
        aria-label={this.props.title}
        className="flex flex-col gap-2 rounded border border-border bg-bg p-4"
      >
        <h2 className="text-body font-semibold text-fg">{this.props.title}</h2>
        <div role="alert" className="flex flex-wrap items-center gap-3 px-2 py-1.5">
          <p className="text-small text-fg">Something went wrong here.</p>
          <Button size="sm" variant="secondary" onClick={() => this.setState({ failed: false })}>
            Retry
          </Button>
        </div>
      </section>
    );
  }
}
