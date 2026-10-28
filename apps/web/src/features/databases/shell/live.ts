/**
 * Live refetch (decision 0200; lane plan "Live"). After each commit the server nudges the topic
 * `db:<databaseId>`, and the screens load again through the normal routes:
 * - `schema-changed`: properties, views or settings changed, so everything (the database, its
 *   views' rows and charts, row pages);
 * - `rows-changed` (with `data.rowIds`, absent when the database has row access rules): the rows
 *   in every view and chart, and those rows' pages;
 * - `live-reconnected`: events may have been missed, so everything.
 * While this tab's own changes to the database are on their way, the refetch waits for them, so
 * what they show doesn't flicker back; their answers bring the rest. The events that come in the
 * meantime share one refetch.
 */
import { useRef } from 'react';
import { useQueryClient, type Query, type QueryClient } from '@tanstack/react-query';
import type { Id } from '@carehub/databases';
import { useLiveTopic, type LiveEvent } from '../../live';
import { databaseKeys } from '../hooks';

export function liveTopic(databaseId: Id): string {
  return `db:${databaseId}`;
}

/** Which of the database's queries an event makes stale; null for events it doesn't change. */
export function staleQueries(event: LiveEvent): ((query: Query) => boolean) | null {
  const part = (query: Query) => query.queryKey[2];
  switch (event.type) {
    case 'schema-changed':
    case 'live-reconnected':
      return () => true;
    case 'rows-changed': {
      const rowIds = event.data?.rowIds;
      const changed = Array.isArray(rowIds) ? new Set<unknown>(rowIds) : null;
      return (query) =>
        part(query) === 'row'
          ? changed === null || changed.has(query.queryKey[3])
          : part(query) !== 'meta';
    }
    default:
      return null;
  }
}

/** Runs `run` once none of this tab's writes to the database are on their way. */
export function whenWritesSettle(queryClient: QueryClient, databaseId: Id, run: () => void) {
  const writing = () => queryClient.isMutating({ mutationKey: databaseKeys.all(databaseId) }) > 0;
  if (!writing()) {
    run();
    return;
  }
  const stop = queryClient.getMutationCache().subscribe(() => {
    if (writing()) return;
    stop();
    run();
  });
}

/** The events waiting for this tab's writes to the database, reloaded together. */
interface Waiting {
  databaseId: Id;
  stale: ((query: Query) => boolean)[];
}

/** Keeps a database's screens up to date while they show. */
export function useDatabaseLive(databaseId: Id): void {
  const queryClient = useQueryClient();
  const waiting = useRef<Waiting | null>(null);
  useLiveTopic(liveTopic(databaseId), (event) => {
    const predicate = staleQueries(event);
    if (!predicate) return;
    if (waiting.current?.databaseId === databaseId) {
      waiting.current.stale.push(predicate);
      return;
    }
    const batch: Waiting = { databaseId, stale: [predicate] };
    waiting.current = batch;
    whenWritesSettle(queryClient, databaseId, () => {
      if (waiting.current === batch) waiting.current = null;
      void queryClient.invalidateQueries({
        queryKey: databaseKeys.all(databaseId),
        predicate: (query) => batch.stale.some((stale) => stale(query)),
      });
    });
  });
}
