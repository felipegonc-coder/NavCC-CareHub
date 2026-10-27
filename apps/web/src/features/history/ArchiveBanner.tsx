// The yellow banner of an archived page and its sub-pages (spec 2, HT-14), above the title
// (pageBanners slot): "Archived by Sam Ortiz on Oct 20, 2026 · Unarchive". Unarchive shows only
// with Full access on the page that was archived, and puts back everything that went with it.
import { archivedText } from '@carehub/extras/history';
import { Button } from '@carehub/ui';
import { useQuery } from '@tanstack/react-query';
import { Archive } from 'lucide-react';
import { useEffect } from 'react';
import { getArchive, historyKeys } from './api';
import { setKnownArchived, useArchiveChange } from './archive';
import type { WatchedPage } from './HistoryPageWatcher';

export function ArchiveBanner({ page }: { page: WatchedPage }) {
  // A failed check shows no banner; the page itself says when it's gone or closed to the person.
  const state = useQuery({
    queryKey: historyKeys.archive(page.id),
    queryFn: ({ signal }) => getArchive(page.id, signal),
    retry: false,
  });
  const unarchive = useArchiveChange(page.id);
  const archived = state.data?.archived ?? null;
  useEffect(() => {
    if (state.data) setKnownArchived(page.id, state.data.archived !== null);
  }, [page.id, state.data]);

  if (!archived) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded bg-yellow-bg px-3 py-1 text-small text-fg">
      <Archive aria-hidden className="size-4 shrink-0 text-yellow-text" />
      <span>{archivedText(archived)}</span>
      {state.data?.canChange && (
        <>
          <span aria-hidden>·</span>
          <Button
            variant="ghost"
            size="sm"
            loading={unarchive.isPending}
            onClick={() => unarchive.mutate(false)}
          >
            Unarchive
          </Button>
        </>
      )}
    </div>
  );
}
