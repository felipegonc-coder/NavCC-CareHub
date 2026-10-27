// History's part of the page view (pageBanners slot); it draws nothing. `?version=` links, which
// Copy link gives, and Ctrl+Alt+H open Version history, and people editing see the note when
// someone else restores a version (HT-05).
import { restoreNote, versionDate } from '@carehub/extras/history';
import { useToast } from '@carehub/ui';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useLiveTopic } from '../live';
import { getVersion } from './api';
import { isOwnRestore, openVersionHistory } from './store';

export interface WatchedPage {
  id: string;
  kind: 'page' | 'database' | 'row';
  title: string;
}

type ShortcutKeys = Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'code'>;

/** Ctrl+Alt+H, read by key position so it works with every keyboard layout. */
export function isHistoryShortcut(event: ShortcutKeys): boolean {
  return (
    event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && event.code === 'KeyH'
  );
}

/** The note for a restore, or null for one this tab made (its window showed the note already). */
async function noteFor(pageId: string, versionId: string): Promise<string | null> {
  if (await isOwnRestore(pageId, versionId)) return null;
  try {
    // The version saved just before the restore: who restored, and from when.
    const { version } = await getVersion(pageId, versionId);
    const from = versionDate(version.restoredFrom ?? version.createdAt);
    return restoreNote(version.createdBy?.name ?? 'Someone', from);
  } catch {
    return null; // The note is a courtesy; the page shows the restored content either way.
  }
}

export function HistoryPageWatcher({ page }: { page: WatchedPage }) {
  const { id, title } = page;
  // A database's rows keep their own history; the database itself has no versions.
  const hasVersions = page.kind !== 'database';
  const [params, setParams] = useSearchParams();
  const linked = hasVersions ? params.get('version') : null;
  const { toast } = useToast();

  useEffect(() => {
    if (!linked) return;
    openVersionHistory({ id, title }, linked);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('version');
        return next;
      },
      { replace: true },
    );
  }, [linked, id, title, setParams]);

  useEffect(() => {
    if (!hasVersions) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isHistoryShortcut(event)) return;
      event.preventDefault();
      openVersionHistory({ id, title });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasVersions, id, title]);

  // The server lets only people with Can edit hear the topic.
  useLiveTopic(hasVersions ? `history:${id}` : null, (event) => {
    const versionId = event.data?.versionId;
    if (event.type !== 'history.restored' || typeof versionId !== 'string') return;
    void noteFor(id, versionId).then((note) => {
      if (note) toast({ title: note });
    });
  });

  return null;
}
