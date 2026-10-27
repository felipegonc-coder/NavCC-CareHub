// Archive from the page menu (spec 3.5, HT-14), drawn once by the app shell (overlays slot). The
// confirm says what turns read-only and how many sub-pages go along. Without Full access it says
// so; the server checks again. Esc or going to another screen closes it.
import { archiveQuestion, archiveTitle, type ArchiveState } from '@carehub/extras/history';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@carehub/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { ApiError } from '../../lib/api';
import { getArchive, historyKeys } from './api';
import { closeArchive, useArchiveChange, useArchiveConfirm } from './archive';
import type { HistoryPageRef } from './store';

export function ArchiveDialog() {
  const page = useArchiveConfirm();

  const { pathname } = useLocation();
  const openedOn = useRef<string | null>(null);
  useEffect(() => {
    if (page === null) openedOn.current = null;
    else if (openedOn.current === null) openedOn.current = pathname;
    else if (openedOn.current !== pathname) closeArchive();
  }, [page, pathname]);

  return (
    <Dialog
      open={page !== null}
      onOpenChange={(next) => {
        if (!next) closeArchive();
      }}
    >
      {page && <ArchiveConfirm key={page.id} page={page} />}
    </Dialog>
  );
}

/** Why the page can't be archived now, or null when it can. */
function refusal(state: ArchiveState): string | null {
  if (state.archived) return 'This page is already archived.';
  if (!state.canChange) return 'Only people with Full access can archive this page.';
  return null;
}

function ArchiveConfirm({ page }: { page: HistoryPageRef }) {
  const state = useQuery({
    queryKey: historyKeys.archive(page.id),
    queryFn: ({ signal }) => getArchive(page.id, signal),
    retry: false,
  });
  const archive = useArchiveChange(page.id);

  let reason = state.data ? refusal(state.data) : null;
  if (state.isError) {
    reason = state.error instanceof ApiError ? state.error.message : "Couldn't check this page.";
  }
  const ready = state.data !== undefined && reason === null;
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{archiveTitle(page.title)}</DialogTitle>
        <DialogDescription>
          {reason ?? (state.data ? archiveQuestion(state.data.subPages) : 'Checking the page…')}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">{ready ? 'Cancel' : 'Close'}</Button>
        </DialogClose>
        {ready && (
          <Button
            loading={archive.isPending}
            onClick={() => archive.mutate(true, { onSettled: closeArchive })}
          >
            Archive
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
