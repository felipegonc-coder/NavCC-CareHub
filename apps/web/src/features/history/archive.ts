// Archive in the page (spec 3.5, HT-14): which page the Archive confirm is open for, which pages
// are known to be archived (their banner says so, and the page menu leaves Archive out), and the
// change itself, shared by the confirm and the banner's Unarchive.
import { archiveDoneText } from '@carehub/extras/history';
import { useToast } from '@carehub/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { ApiError } from '../../lib/api';
import { changeArchive, historyKeys } from './api';
import type { HistoryPageRef } from './store';

let open: HistoryPageRef | null = null;
const listeners = new Set<() => void>();
const archived = new Set<string>();

function changed(next: HistoryPageRef | null) {
  open = next;
  for (const listener of listeners) listener();
}

/** Opens the Archive confirm for `page`. */
export function openArchive(page: HistoryPageRef): void {
  changed({ id: page.id, title: page.title });
}

export function closeArchive(): void {
  if (open !== null) changed(null);
}

/** The page whose Archive confirm is open, kept up to date. */
export function useArchiveConfirm(): HistoryPageRef | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => open,
    () => null,
  );
}

/** What the page's banner found out. */
export function setKnownArchived(pageId: string, isArchived: boolean): void {
  if (isArchived) archived.add(pageId);
  else archived.delete(pageId);
}

/** Whether the page is known to be archived; the page menu then has no Archive. */
export function isKnownArchived(pageId: string): boolean {
  return archived.has(pageId);
}

/** Archives (true) or unarchives (false) the page, then says what changed and how many went along. */
export function useArchiveChange(pageId: string) {
  const client = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (archive: boolean) => changeArchive(pageId, archive),
    onSuccess: (change, archive) => toast({ title: archiveDoneText(change, archive) }),
    onError: (error, archive) =>
      toast({
        title: archive ? "Couldn't archive this page." : "Couldn't unarchive this page.",
        description: error instanceof ApiError ? error.message : 'Try again.',
        variant: 'danger',
      }),
    // The sub-pages changed too, and the page view and sidebar tree (core's `pages` queries).
    // Not waited for, so the confirm closes before the new state shows in it.
    onSettled: () => {
      void client.invalidateQueries({ queryKey: historyKeys.archives });
      void client.invalidateQueries({ queryKey: ['pages'] });
    },
  });
}
