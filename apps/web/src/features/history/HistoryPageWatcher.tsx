// History's part of the page view (pageBanners slot); it draws nothing. `?version=` links, which
// Copy link gives, and Ctrl+Alt+H open Version history.
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { openVersionHistory } from './store';

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

export function HistoryPageWatcher({ page }: { page: WatchedPage }) {
  const { id, title } = page;
  // A database's rows keep their own history; the database itself has no versions.
  const hasVersions = page.kind !== 'database';
  const [params, setParams] = useSearchParams();
  const linked = hasVersions ? params.get('version') : null;

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

  return null;
}
