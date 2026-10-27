/**
 * What a database shows instead of rows (spec section 2, States): loading, no rows, no matches,
 * an error with Retry, no access, a view that uses a hidden property, and the bar over a view the
 * viewer changed for themselves. All of it stays inside the block; the rest of the page works.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { ViewLayout } from '@carehub/databases';
import { Button, Skeleton } from '@carehub/ui';
import { isApiError, UNKNOWN_ERROR_MESSAGE } from '../api';

/** Text the states show, word for word. */
export const STATE_TEXT = {
  noRows: 'No rows yet.',
  noMatches: 'No rows match.',
  noAccess: "You don't have access to this database.",
  changedForYou: 'Changed for you only',
} as const;

/** Loading skeletons wait this long, so quick answers don't flash (decision 0007). */
export const SKELETON_DELAY_MS = 300;

/** Phones: buttons are at least 44 px tall. */
export const TOUCH = 'max-md:min-h-11';

/** The reason to show for a failed request. */
export function errorText(error: unknown): string {
  return isApiError(error) ? error.message : UNKNOWN_ERROR_MESSAGE;
}

function useShownAfter(ms: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return shown;
}

const BAR = 'h-8 w-full';

/**
 * Grey shapes while rows load: a header and 5 row bars (table, list and the rest), or 3 cards
 * (board, gallery). With `title`, the database's title and tabs are loading too.
 */
export function LoadingRows({ layout, title = false }: { layout: ViewLayout; title?: boolean }) {
  const shown = useShownAfter(SKELETON_DELAY_MS);
  if (!shown) return <div aria-busy="true" />;
  const cards = layout === 'board' || layout === 'gallery';
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      {title && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="h-6 w-48 max-w-full" />
        </div>
      )}
      <div data-testid="database-loading" className={cards ? 'flex gap-4' : 'flex flex-col gap-2'}>
        {cards
          ? [0, 1, 2].map((n) => <Skeleton key={n} className="h-32 flex-1" />)
          : [0, 1, 2, 3, 4, 5].map((n) => <Skeleton key={n} className={BAR} />)}
      </div>
    </div>
  );
}

function Message({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <p className="text-body text-muted">{text}</p>
      {children && <div className="flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/** "No rows yet." with New and Import CSV, each only when the viewer may. */
export function NoRows({ onNew, onImportCsv }: { onNew?: () => void; onImportCsv?: () => void }) {
  return (
    <Message text={STATE_TEXT.noRows}>
      {onNew && (
        <Button size="sm" className={TOUCH} onClick={onNew}>
          New
        </Button>
      )}
      {onImportCsv && (
        <Button size="sm" variant="secondary" className={TOUCH} onClick={onImportCsv}>
          Import CSV
        </Button>
      )}
    </Message>
  );
}

/** "No rows match." with Clear filters and Clear search for whichever is on. */
export function NoMatches({
  onClearFilters,
  onClearSearch,
}: {
  onClearFilters?: () => void;
  onClearSearch?: () => void;
}) {
  return (
    <Message text={STATE_TEXT.noMatches}>
      {onClearFilters && (
        <Button size="sm" variant="secondary" className={TOUCH} onClick={onClearFilters}>
          Clear filters
        </Button>
      )}
      {onClearSearch && (
        <Button size="sm" variant="secondary" className={TOUCH} onClick={onClearSearch}>
          Clear search
        </Button>
      )}
    </Message>
  );
}

/** The reason something failed, and Retry when trying again can help. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <p className="text-body text-fg">{errorText(error)}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" className={TOUCH} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** Someone without access to the database: no title, nothing about it. */
export function NoAccess() {
  return <Message text={STATE_TEXT.noAccess} />;
}

/** A view that uses a property the viewer can't see: the server's message instead of rows. */
export function Blocked({ message }: { message: string }) {
  return <Message text={message} />;
}

/** "Changed for you only · Reset" over a view the viewer changed for themselves. */
export function OverrideBar({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex items-center gap-1 self-start rounded bg-fill py-0.5 pl-3 pr-0.5 text-small text-muted">
      <span>{STATE_TEXT.changedForYou}</span>
      <span aria-hidden="true">·</span>
      <Button variant="ghost" size="sm" className={TOUCH} onClick={onReset}>
        Reset
      </Button>
    </div>
  );
}
