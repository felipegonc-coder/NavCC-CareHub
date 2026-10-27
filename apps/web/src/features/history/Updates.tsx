// The Updates panel (section 3.3; HT-08): what happened on the page, grouped per person and hour,
// newest first, 50 at a time. Viewers see who did what and when; with Can edit an edit also has
// Show changes, which opens Version history on its version.
import { groupUpdates, updatePerson, updateText, versionWhen } from '@carehub/extras/history';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  NoAccessState,
  NotFoundState,
} from '@carehub/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiError } from '../../lib/api';
import { historyKeys, listUpdates } from './api';

const statusOf = (error: unknown) => (error instanceof ApiError ? error.status : 0);
/** A refusal or a missing page doesn't change on a second try. */
const retryOnce = (failures: number, error: unknown) =>
  failures < 1 && ![403, 404].includes(statusOf(error));

export interface UpdatesProps {
  pageId: string;
  /** Show changes: opens Version history on the version. */
  onShowChanges(versionId: string): void;
}

export function Updates({ pageId, onShowChanges }: UpdatesProps) {
  const list = useInfiniteQuery({
    queryKey: historyKeys.updates(pageId),
    queryFn: ({ pageParam, signal }) => listUpdates(pageId, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    retry: retryOnce,
  });
  // Grouped across everything loaded, so a group can grow when older entries arrive.
  const groups = useMemo(
    () => groupUpdates(list.data?.pages.flatMap((one) => one.updates) ?? []),
    [list.data],
  );

  if (list.isPending) return <LoadingState label="Loading updates" className="p-6" />;
  if (list.isError) {
    if (statusOf(list.error) === 403) return <NoAccessState />;
    if (statusOf(list.error) === 404) return <NotFoundState />;
    return (
      <ErrorState
        message={list.error instanceof ApiError ? list.error.message : undefined}
        onRetry={() => void list.refetch()}
        retrying={list.isRefetching}
      />
    );
  }
  if (groups.length === 0) return <EmptyState message="Nothing has happened on this page yet." />;

  const now = new Date();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
      <ol aria-label="Updates" className="flex flex-col gap-4">
        {groups.map((group) => {
          const name = updatePerson(group.by);
          return (
            <li key={group.key} className="flex gap-3">
              <Avatar name={name} size="sm" decorative />
              <div className="min-w-0 flex-1">
                <p className="text-small">
                  <span className="font-medium text-fg">{name}</span>
                  <span className="text-muted">
                    {' · '}
                    <time dateTime={group.at}>{versionWhen(group.at, now)}</time>
                  </span>
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {group.updates.map((update) => {
                    const { versionId } = update;
                    return (
                      <li key={update.id} className="flex flex-wrap items-center gap-2 text-small">
                        {/* Each line reads whole: "Sam Ortiz edited · 3 changes". */}
                        <span>
                          <span className="sr-only">{name} </span>
                          {updateText(update, now)}
                        </span>
                        {versionId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onShowChanges(versionId)}
                          >
                            Show changes
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>
      {list.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="self-center"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          Show older updates
        </Button>
      )}
    </div>
  );
}
