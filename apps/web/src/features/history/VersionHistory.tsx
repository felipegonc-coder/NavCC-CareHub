// Version history (section 2; HT-04, HT-07, HT-16): the preview fills the left and the versions
// sit on the right, newest first and grouped by day, named ones in bold; ↑ and ↓ move between
// versions. On phones the list shows first, and the preview after a tap.
import { versionKindLabel, versionLine } from '@carehub/extras/history';
import {
  Button,
  cn,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  NoAccessState,
  NotFoundState,
  Switch,
  useToast,
} from '@carehub/ui';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { ApiError } from '../../lib/api';
import { useLiveTopic } from '../live';
import { getVersion, historyKeys, listVersions, versionLink } from './api';
import { groupByDay, stepIndex } from './versionList';
import { VersionPreview } from './VersionPreview';

/** More versions load when the selection gets this close to the end of the list. */
const LOAD_MORE_WITHIN = 3;

const statusOf = (error: unknown) => (error instanceof ApiError ? error.status : 0);
const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : undefined);
/** A refusal or a missing version doesn't change on a second try. */
const retryOnce = (failures: number, error: unknown) =>
  failures < 1 && ![403, 404].includes(statusOf(error));

export interface VersionHistoryProps {
  pageId: string;
  /** The version to show first; the newest when null. */
  initialVersionId: string | null;
}

export function VersionHistory({ pageId, initialVersionId }: VersionHistoryProps) {
  const client = useQueryClient();
  const { toast } = useToast();
  const optionPrefix = useId();
  const listboxRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const [picked, setPicked] = useState(initialVersionId);
  const [showChanges, setShowChanges] = useState(true);
  const [phonePreview, setPhonePreview] = useState(initialVersionId !== null);

  const list = useInfiniteQuery({
    queryKey: historyKeys.list(pageId),
    queryFn: ({ pageParam, signal }) => listVersions(pageId, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    retry: retryOnce,
  });
  const versions = useMemo(
    () => list.data?.pages.flatMap((one) => one.versions) ?? [],
    [list.data],
  );
  const selectedId = picked ?? versions[0]?.id ?? null;

  const version = useQuery({
    queryKey: historyKeys.version(pageId, selectedId ?? ''),
    queryFn: ({ signal }) => getVersion(pageId, selectedId ?? '', signal),
    enabled: selectedId !== null,
    retry: retryOnce,
  });
  // A linked version can be older than the loaded part of the list.
  const shown =
    versions.find((one) => one.id === selectedId) ??
    (version.data?.version.id === selectedId ? version.data.version : null);

  // New versions, a restore, or a reconnect after missed events.
  useLiveTopic(`history:${pageId}`, (event) => {
    if (['history.versions', 'history.restored', 'live-reconnected'].includes(event.type)) {
      void client.invalidateQueries({ queryKey: historyKeys.list(pageId) });
    }
  });

  // The list takes focus once it loads. While a phone shows the preview its back button does; on
  // wider screens that button is hidden, can't take focus, and the list keeps it.
  const loaded = versions.length > 0;
  useEffect(() => {
    if (!loaded) return;
    if (phonePreview) backRef.current?.focus();
    if (!phonePreview || document.activeElement !== backRef.current) listboxRef.current?.focus();
  }, [loaded, phonePreview]);

  useEffect(() => {
    if (selectedId === null) return;
    document
      .getElementById(`${optionPrefix}-${selectedId}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [optionPrefix, selectedId]);

  function select(index: number) {
    const next = versions[index];
    if (!next) return;
    setPicked(next.id);
    if (index >= versions.length - LOAD_MORE_WITHIN && list.hasNextPage && !list.isFetchingNextPage)
      void list.fetchNextPage();
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = versions.findIndex((one) => one.id === selectedId);
    const to = stepIndex(event.key, index, versions.length);
    if (to === null) return;
    event.preventDefault();
    select(to);
  }

  function onListClick(event: MouseEvent<HTMLDivElement>) {
    const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
    const id = option?.dataset.versionId;
    if (!id) return;
    setPicked(id);
    setPhonePreview(true);
  }

  async function copyLink(versionId: string) {
    try {
      await navigator.clipboard.writeText(versionLink(pageId, versionId));
      toast({ title: 'Link copied' });
    } catch {
      toast({ title: "Couldn't copy the link.", variant: 'danger' });
    }
  }

  if (list.isPending) return <LoadingState label="Loading versions" className="p-6" />;
  if (list.isError) {
    if (statusOf(list.error) === 403) return <NoAccessState />;
    if (statusOf(list.error) === 404) return <NotFoundState />;
    return (
      <ErrorState
        message={messageOf(list.error)}
        onRetry={() => void list.refetch()}
        retrying={list.isRefetching}
      />
    );
  }
  if (!loaded) return <EmptyState message="Versions appear here after the first edits." />;

  let preview: ReactNode;
  if (version.isPending) preview = <LoadingState label="Loading the version" />;
  else if (version.isError) {
    const status = statusOf(version.error);
    // 404: "This version is too old to show (deleted under the Data settings period)."
    if (status === 404) preview = <EmptyState message={messageOf(version.error)} />;
    else if (status === 403) preview = <NoAccessState />;
    else
      preview = (
        <ErrorState
          message={messageOf(version.error)}
          onRetry={() => void version.refetch()}
          retrying={version.isRefetching}
        />
      );
  } else
    preview = (
      <VersionPreview
        page={version.data.page}
        previous={version.data.previous?.page ?? null}
        showChanges={showChanges}
        className="mx-auto w-full max-w-page"
      />
    );

  const now = new Date();
  return (
    <div className="flex min-h-0 flex-1">
      <section
        aria-label="Version preview"
        className={cn('flex min-w-0 flex-1 flex-col', !phonePreview && 'max-md:hidden')}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <Button
            ref={backRef}
            variant="ghost"
            size="sm"
            className="md:hidden"
            onClick={() => setPhonePreview(false)}
          >
            <ChevronLeft aria-hidden />
            Versions
          </Button>
          <Field label="Show changes" layout="inline" className="mr-auto">
            <Switch checked={showChanges} onCheckedChange={setShowChanges} />
          </Field>
          {shown && (
            <Button variant="ghost" size="sm" onClick={() => void copyLink(shown.id)}>
              Copy link
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">{preview}</div>
      </section>

      <div
        className={cn(
          'flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-l border-border p-2 max-md:w-full max-md:border-l-0',
          phonePreview && 'max-md:hidden',
        )}
      >
        <div
          ref={listboxRef}
          role="listbox"
          aria-label="Versions"
          tabIndex={0}
          aria-activedescendant={
            shown && versions.includes(shown) ? `${optionPrefix}-${shown.id}` : undefined
          }
          onKeyDown={onListKeyDown}
          onClick={onListClick}
          className="flex flex-col gap-3 rounded"
        >
          {groupByDay(versions, now).map((group) => (
            <div key={group.day} role="group" aria-label={group.day} className="flex flex-col">
              <div aria-hidden className="px-2 py-1 text-label font-medium text-muted">
                {group.day}
              </div>
              {group.versions.map((one) => {
                const kind = versionKindLabel(one.kind);
                return (
                  <div
                    key={one.id}
                    id={`${optionPrefix}-${one.id}`}
                    role="option"
                    aria-selected={one.id === selectedId}
                    data-version-id={one.id}
                    className={cn(
                      'flex cursor-default flex-col gap-0.5 rounded px-2 py-1.5 text-small hover:bg-fill-hover max-md:min-h-11',
                      one.id === selectedId && 'bg-fill',
                    )}
                  >
                    {one.name && <span className="font-semibold">{one.name}</span>}{' '}
                    <span>{versionLine(one, now)}</span>{' '}
                    {kind && <span className="text-label text-muted">{kind}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {list.hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            Show older versions
          </Button>
        )}
      </div>
    </div>
  );
}
